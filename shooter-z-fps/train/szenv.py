"""Shooter Z as a Stable-Baselines3 VecEnv, played by the Node batch server (PROTOCOL.md, protocol 2).

The game rules live only in TypeScript (src/core). This file talks the protocol: it sends one action per
agent, gets observations and events back, and turns events into the reward with reward.json (every term
also reported on its own in `infos`).

Actions are MultiDiscrete (SB3 can't mix discrete buttons with continuous aim in one action):
  forward 3, strafe 3, jump 2, crouch 2, yaw 13, pitch 11, fire 2, reload 2, ability 2
Yaw and pitch pick a turn per tick from a table that is fine near zero (precise aim: the smallest step
is about 0.3 degrees per decision) and coarse far from it (fast turns).

One server process = one ShooterVecEnv. Its `opponent` sets robot 1:
  "bot" / "still" / "moving"  -> one learner per match (n_envs agents)
  "self"                      -> self-play, both robots learn (2 x n_envs agents)
  "frozen"                    -> self-play against a frozen snapshot that this class drives itself;
                                 only robot 0 learns (n_envs agents)
MultiShooterVecEnv joins several of them, and can be reconfigured between rollouts (curriculum stages).
"""

from __future__ import annotations

import json
import socket
import struct
from pathlib import Path

import numpy as np
from gymnasium import spaces
from stable_baselines3.common.vec_env.base_vec_env import VecEnv

HERE = Path(__file__).resolve().parent
CMD_CLOSE, CMD_RESET, CMD_STEP, CMD_REPLAY, CMD_SEED = 0, 1, 2, 3, 4

# turn per tick, as a fraction of the turn cap (x turn_cap x 3 ticks per decision)
YAW_BINS = np.array([-1, -0.5, -0.25, -0.1, -0.03, -0.01, 0, 0.01, 0.03, 0.1, 0.25, 0.5, 1], dtype=np.float32)
PITCH_BINS = np.array([-1, -0.4, -0.15, -0.04, -0.01, 0, 0.01, 0.04, 0.15, 0.4, 1], dtype=np.float32)
ACTION_NVEC = [3, 3, 2, 2, len(YAW_BINS), len(PITCH_BINS), 2, 2, 2]
NOOP_ACTION = np.array([1, 1, 0, 0, 6, 5, 0, 0, 0], dtype=np.int64)  # stand still, no turn
# derived reward terms (computed here, not sent by the game)
DERIVED = {"wastedShots", "noProgress", "enemyVisible"}
# ray layout (PROTOCOL.md obs_layout): 256 rays x 11 = distance, 9 label flags, protected
N_RAYS, RAY_FEATURES = 256, 11
ENEMY_LABELS = [1 + 4, 1 + 5, 1 + 6, 1 + 8]  # enemyHead, enemyTorso, enemyLegs, enemyShield


def enemy_visible(obs: np.ndarray) -> np.ndarray:
    """1.0 for each observation with an enemy on screen."""
    rays = obs[:, : N_RAYS * RAY_FEATURES].reshape(len(obs), N_RAYS, RAY_FEATURES)
    return (rays[:, :, ENEMY_LABELS] > 0).any(axis=(1, 2)).astype(np.float32)


def load_reward(path: Path = HERE / "reward.json") -> tuple[dict[str, float], set[str], float]:
    """({term: weight}, {helper terms}, no-progress seconds)."""
    cfg = json.loads(path.read_text())
    weights = {k: float(v["w"]) for k, v in cfg["weights"].items()}
    helpers = {k for k, v in cfg["weights"].items() if v.get("helper")}
    return weights, helpers, float(cfg.get("no_progress_after_s", 10))


def to_vector(md: np.ndarray) -> np.ndarray:
    """MultiDiscrete actions (n, 9) -> the protocol's float vector (n, 9)."""
    v = np.zeros((len(md), 9), dtype=np.float32)
    v[:, 0] = md[:, 0] - 1.0
    v[:, 1] = md[:, 1] - 1.0
    v[:, 2] = md[:, 2]
    v[:, 3] = md[:, 3]
    v[:, 4] = YAW_BINS[md[:, 4]]
    v[:, 5] = PITCH_BINS[md[:, 5]]
    v[:, 6:9] = md[:, 6:9]
    return v


class Conn:
    """Length-prefixed messages over TCP."""

    def __init__(self, port: int, host: str = "127.0.0.1", timeout: float = 300.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def send(self, body: bytes) -> None:
        self.sock.sendall(struct.pack("<I", len(body)) + body)

    def recv(self) -> bytes:
        (n,) = struct.unpack("<I", self._exactly(4))
        return self._exactly(n)

    def _exactly(self, n: int) -> bytes:
        buf = bytearray(n)
        view, got = memoryview(buf), 0
        while got < n:
            k = self.sock.recv_into(view[got:], n - got)
            if k == 0:
                raise ConnectionError("game server closed the connection")
            got += k
        return bytes(buf)

    def close(self) -> None:
        self.sock.close()


class ShooterVecEnv(VecEnv):
    def __init__(self, port: int, n_envs: int, opponent: str = "bot", seed_base: int = 1_000_000,
                 max_ticks: int = 60 * 60 * 3, options: dict | None = None, frozen=None,
                 reward: tuple | None = None):
        """opponent: bot | still | moving | self | frozen. options: other handshake fields (opponent_skill,
        map, mode, character, score_limit, turn_cap). frozen: an object with predict(obs, state,
        episode_start) for "frozen" (a snapshot of the policy)."""
        self.port, self.n_matches, self.opponent = port, n_envs, opponent
        wire = {"self": "learner", "frozen": "learner"}.get(opponent, opponent)
        self.conn = Conn(port)
        self.conn.send(json.dumps({"n_envs": n_envs, "seed_base": seed_base, "max_ticks": max_ticks,
                                   "opponent": wire, **(options or {})}).encode())
        self.hello = json.loads(self.conn.recv())
        self.obs_size = self.hello["obs_size"]
        self.fields: list[str] = self.hello["event_fields"]
        self.f = {k: i for i, k in enumerate(self.fields)}
        self.L = len(self.hello["learner_slots"])  # agents per match on the wire
        rays = self.hello["obs_layout"]["rays"]
        labels = rays["labels"]
        if (rays["n"], rays["features_per_ray"]) != (N_RAYS, RAY_FEATURES) or [1 + labels.index(k) for k in ("enemyHead", "enemyTorso", "enemyLegs", "enemyShield")] != ENEMY_LABELS:
            raise ValueError("the game's ray layout changed: update N_RAYS / ENEMY_LABELS in szenv.py")
        self.wire_agents = n_envs * self.L
        # agents SB3 trains on: every wire agent, except robot 1 when a frozen snapshot drives it
        self.train_idx = np.arange(self.wire_agents) if opponent != "frozen" else np.arange(0, self.wire_agents, 2)
        self.frozen, self.frozen_state, self.frozen_start = frozen, None, None
        self.weights, self.helpers, no_progress_s = reward or load_reward()
        self.no_progress_after = int(no_progress_s * self.hello["tick_hz"] / self.hello["decision_ticks"])
        self.helper_scale = 1.0  # the trainer fades helper terms by lowering this
        self._calm = np.zeros(self.wire_agents, dtype=np.int64)  # decisions since damage dealt or taken
        self._ep = np.zeros((self.wire_agents, len(self.fields)), dtype=np.float64)
        self._ep_steps = np.zeros(self.wire_agents, dtype=np.int64)
        self._last_obs = np.zeros((self.wire_agents, self.obs_size), dtype=np.float32)
        self._actions = None
        super().__init__(len(self.train_idx), spaces.Box(-np.inf, np.inf, (self.obs_size,), np.float32),
                         spaces.MultiDiscrete(ACTION_NVEC))

    # --- VecEnv API ---------------------------------------------------------------------------
    def reset(self) -> np.ndarray:
        self.conn.send(bytes([CMD_RESET]))
        obs = np.frombuffer(self.conn.recv(), np.float32).reshape(self.wire_agents, self.obs_size).copy()
        self._last_obs[:] = obs
        self._calm[:] = 0
        self._ep[:] = 0
        self._ep_steps[:] = 0
        self.frozen_state, self.frozen_start = None, np.ones(self.n_matches, dtype=bool)
        return obs[self.train_idx]

    def step_async(self, actions: np.ndarray) -> None:
        self._actions = np.asarray(actions, dtype=np.int64).reshape(self.num_envs, len(ACTION_NVEC))

    def step_wait(self):
        self._send_step()
        return self._recv_step()

    def _send_step(self) -> None:
        md = np.tile(NOOP_ACTION, (self.wire_agents, 1))
        md[self.train_idx] = self._actions
        if self.opponent == "frozen":  # robot 1 of every match, driven by the snapshot
            opp_obs = self._last_obs[1::2]
            act, self.frozen_state = self.frozen.predict(opp_obs, state=self.frozen_state,
                                                         episode_start=self.frozen_start, deterministic=False)
            md[1::2] = act
        self.conn.send(bytes([CMD_STEP]) + to_vector(md).tobytes())

    def _recv_step(self):
        msg = self.conn.recv()
        n, k = self.wire_agents, len(self.fields)
        off = 0
        obs = np.frombuffer(msg, np.float32, n * self.obs_size, off).reshape(n, self.obs_size).copy(); off += 4 * n * self.obs_size
        ev = np.frombuffer(msg, np.float32, n * k, off).reshape(n, k); off += 4 * n * k
        terminated = np.frombuffer(msg, np.uint8, n, off).astype(bool); off += n
        truncated = np.frombuffer(msg, np.uint8, n, off).astype(bool); off += n
        cause = np.frombuffer(msg, np.uint8, n, off); off += n
        seeds = np.frombuffer(msg, np.uint32, n, off); off += 4 * n
        (n_done,) = struct.unpack_from("<H", msg, off); off += 2
        terminal = {}
        for _ in range(n_done):
            (a,) = struct.unpack_from("<H", msg, off); off += 2
            terminal[a] = np.frombuffer(msg, np.float32, self.obs_size, off).copy(); off += 4 * self.obs_size
        if off != len(msg):
            raise ValueError(f"step reply has {len(msg) - off} unexpected bytes (protocol mismatch)")

        f = self.f
        seen_obs = obs.copy()  # what the robot sees after this decision (the last frame of a finished match)
        for a, t in terminal.items():
            seen_obs[a] = t
        engaged = (ev[:, f["damageDealt"]] > 0) | (ev[:, f["damageTaken"]] > 0)
        self._calm = np.where(engaged, 0, self._calm + 1)
        terms = {
            "won": ev[:, f["won"]], "lost": ev[:, f["lost"]],
            "damageDealt": ev[:, f["damageDealt"]], "damageTaken": ev[:, f["damageTaken"]],
            "kills": ev[:, f["kills"]], "headshots": ev[:, f["headshots"]],
            "wastedShots": np.maximum(0.0, ev[:, f["shots"]] - ev[:, f["hits"]]),
            "noProgress": (self._calm >= self.no_progress_after).astype(np.float32),
            "enemyVisible": enemy_visible(seen_obs),
        }
        scaled = {name: self.weights.get(name, 0.0) * (self.helper_scale if name in self.helpers else 1.0) * v
                  for name, v in terms.items()}
        rewards = sum(scaled.values())
        dones = terminated | truncated
        self._ep += ev
        for name in ("teamScore", "enemyScore", "ticks"):  # these are totals, not per-decision counts
            self._ep[:, f[name]] = ev[:, f[name]]
        self._ep_steps += 1

        infos = []
        for a in range(n):
            info = {"reward_terms": {name: float(v[a]) for name, v in scaled.items() if self.weights.get(name)}}
            if dones[a]:
                info["terminal_observation"] = terminal[a]
                info["TimeLimit.truncated"] = bool(truncated[a] and not terminated[a])
                e = self._ep[a]
                info["episode_end"] = {
                    "seed": int(seeds[a]), "opponent": self.opponent, "slot": int(a % self.L),
                    "won": bool(cause[a] == 1), "lost": bool(cause[a] == 2), "cut_off": bool(truncated[a]),
                    "minutes": float(e[f["ticks"]]) / self.hello["tick_hz"] / 60,
                    **{name: float(e[f[name]]) for name in ("kills", "deaths", "hits", "headshots", "shots",
                                                             "damageDealt", "damageTaken", "teamScore", "enemyScore")},
                }
                self._ep[a] = 0
                self._ep_steps[a] = 0
                self._calm[a] = 0
            infos.append(info)
        self._last_obs = obs
        if self.opponent == "frozen":
            self.frozen_start = dones[1::2]
        idx = self.train_idx
        return obs[idx], rewards[idx].astype(np.float32), dones[idx], [infos[i] for i in idx]

    def close(self) -> None:
        try:
            self.conn.send(bytes([CMD_CLOSE]))
        finally:
            self.conn.close()

    # --- extras -------------------------------------------------------------------------------
    def set_seed(self, env: int, seed: int) -> np.ndarray:
        """Restart match `env` on exactly this seed. Returns its learners' first observations."""
        self.conn.send(bytes([CMD_SEED]) + struct.pack("<HI", env, seed))
        return np.frombuffer(self.conn.recv(), np.float32).reshape(self.L, self.obs_size).copy()

    def replay(self, env: int):
        self.conn.send(bytes([CMD_REPLAY]) + struct.pack("<H", env))
        return json.loads(self.conn.recv())

    # SB3 requires these; the server owns the games
    def seed(self, seed=None):
        return [None] * self.num_envs

    def get_attr(self, attr_name, indices=None):
        if attr_name == "render_mode":
            return [None] * self.num_envs
        raise AttributeError(attr_name)

    def set_attr(self, attr_name, value, indices=None):
        raise AttributeError(attr_name)

    def env_method(self, method_name, *args, indices=None, **kwargs):
        raise AttributeError(method_name)

    def env_is_wrapped(self, wrapper_class, indices=None):
        return [False] * self.num_envs


class MultiShooterVecEnv(VecEnv):
    """Several ShooterVecEnvs (one per server process) as one VecEnv; all servers step in parallel.
    `reconfigure(specs)` swaps what each server plays (curriculum stages) while keeping the number of
    agents the same, so the PPO model can keep training."""

    def __init__(self, specs: list[dict]):
        self.envs = [ShooterVecEnv(**s) for s in specs]
        super().__init__(sum(e.num_envs for e in self.envs), self.envs[0].observation_space, self.envs[0].action_space)
        self._cuts = np.cumsum([0] + [e.num_envs for e in self.envs])

    def reconfigure(self, specs: list[dict]) -> np.ndarray:
        for e in self.envs:
            e.close()
        self.envs = [ShooterVecEnv(**s) for s in specs]
        total = sum(e.num_envs for e in self.envs)
        if total != self.num_envs:
            raise ValueError(f"a stage must keep {self.num_envs} training agents, this one has {total}")
        self._cuts = np.cumsum([0] + [e.num_envs for e in self.envs])
        return self.reset()

    @property
    def helper_scale(self) -> float:
        return self.envs[0].helper_scale

    @helper_scale.setter
    def helper_scale(self, v: float) -> None:
        for e in self.envs:
            e.helper_scale = v

    def reset(self):
        return np.concatenate([e.reset() for e in self.envs])

    def step_async(self, actions):
        for e, a, b in zip(self.envs, self._cuts[:-1], self._cuts[1:]):
            e.step_async(actions[a:b])
            e._send_step()  # every server starts stepping now, in parallel

    def step_wait(self):
        obs, rew, done, infos = zip(*(e._recv_step() for e in self.envs))
        return np.concatenate(obs), np.concatenate(rew), np.concatenate(done), [i for part in infos for i in part]

    def close(self):
        for e in self.envs:
            e.close()

    def seed(self, seed=None):
        return [None] * self.num_envs

    def get_attr(self, attr_name, indices=None):
        if attr_name == "render_mode":
            return [None] * self.num_envs
        raise AttributeError(attr_name)

    def set_attr(self, attr_name, value, indices=None):
        raise AttributeError(attr_name)

    def env_method(self, method_name, *args, indices=None, **kwargs):
        raise AttributeError(method_name)

    def env_is_wrapped(self, wrapper_class, indices=None):
        return [False] * self.num_envs
