"""The runner game as a Stable-Baselines3 VecEnv, played by the Node batch server over a socket.

The game rules live only in TypeScript (src/core). This file only talks the protocol in PROTOCOL.md:
it sends one action per game, gets back observations and events, and turns events into the reward
with reward.json. Every reward term is also reported on its own in `infos`, so training can log
which part of the reward drives the agent.
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
NOTHING, LEFT, RIGHT, JUMP, ROLL = 0, 1, 2, 3, 4

# The step reply carries these as episode totals so far: they are reported, never rewarded.
TOTALS = {"score", "meters", "ticks"}
# Reward terms computed here rather than sent by the game.
DERIVED = {
    "meters",               # metres moved this decision (from the game's "distance", in mm)
    "moves",                # an action other than "nothing" was chosen
    "reversals",            # a lane change undone within REVERSE_DECISIONS
    "pointlessJumpsRolls",  # a jump or roll started with no obstacle ahead in that lane within REACH_MM
}
REVERSE_DECISIONS = 8  # 8 decisions = 0.53 s
REACH_MM = 12_000      # a jump lasts ~0.6 s; at 20 m/s that is 12 m
# Observation layout of game version 1 (src/core/obs.ts), used when the server does not send "obs_layout".
V1_LAYOUT = {"lanes": 3, "rows": 32, "row_len_mm": 3000, "first_row_offset_mm": -3000,
             "channels": ["low", "high", "trainFront", "trainBody", "ramp", "coin", "moving", "powerup"],
             "state": ["lane0", "lane1", "lane2"]}
NOT_OBSTACLES = {"coin", "powerup"}


def load_reward(path: Path = HERE / "reward.json") -> dict[str, float]:
    """{event name: weight} from reward.json."""
    return {name: float(v["w"]) for name, v in json.loads(path.read_text())["weights"].items()}


class Conn:
    """Length-prefixed messages over TCP (PROTOCOL.md, Transport)."""

    def __init__(self, host: str, port: int, timeout: float = 120.0):
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


class RunnerVecEnv(VecEnv):
    """n_envs games on one server process. Auto-resets finished games (SB3 convention)."""

    def __init__(self, port: int, n_envs: int = 64, seed_base: int = 1_000_000, max_ticks: int = 36_000,
                 reward: dict[str, float] | None = None, host: str = "127.0.0.1"):
        self.conn = Conn(host, port)
        self.conn.send(json.dumps({"n_envs": n_envs, "seed_base": seed_base, "max_ticks": max_ticks}).encode())
        hello = json.loads(self.conn.recv())
        self.version: int = hello["version"]
        self.obs_size: int = hello["obs_size"]
        self.fields: list[str] = hello["event_fields"]
        self.death_causes: list[str] = hello["death_causes"]
        self.reward = reward if reward is not None else load_reward()
        rewardable = (set(self.fields) - TOTALS - {"distance"}) | DERIVED
        unknown = set(self.reward) - rewardable
        if unknown:
            raise ValueError(f"reward.json has terms this game cannot reward: {sorted(unknown)}; allowed: {sorted(rewardable)}")
        # one weight per per-decision event; episode totals and raw mm distance get weight 0
        self._event_terms = [f for f in self.fields if f in self.reward and f not in TOTALS and f != "distance"]
        self._w = np.array([self.reward[f] if f in self._event_terms else 0.0 for f in self.fields], dtype=np.float32)
        self._derived_w = {name: self.reward.get(name, 0.0) for name in DERIVED}
        self._f = {name: j for j, name in enumerate(self.fields)}
        self._layout(hello.get("obs_layout", V1_LAYOUT))
        self._actions = np.zeros(n_envs, dtype=np.uint8)
        self._last_obs = np.zeros((n_envs, self.obs_size), dtype=np.float32)
        self._t = np.zeros(n_envs, dtype=np.int64)            # decisions so far in this episode
        self._last_turn = np.zeros(n_envs, dtype=np.int8)     # -1 left, +1 right, 0 none yet
        self._last_turn_t = np.full(n_envs, -10**9, dtype=np.int64)
        self._count = {k: np.zeros(n_envs, dtype=np.int64) for k in ("moves", "reversals", "pointless", "jumps", "rolls", "laneChanges")}
        observation_space = spaces.Box(-np.inf, np.inf, shape=(self.obs_size,), dtype=np.float32)
        super().__init__(n_envs, observation_space, spaces.Discrete(hello["n_actions"]))

    # --- VecEnv API ---------------------------------------------------------------------------
    def reset(self) -> np.ndarray:
        self._send_reset()
        return self._recv_reset()

    def _send_reset(self) -> None:
        self.conn.send(bytes([CMD_RESET]))

    def _recv_reset(self) -> np.ndarray:
        obs = self._obs(self.conn.recv(), 0)[0]
        self._last_obs[:] = obs
        for i in range(self.num_envs):
            self._new_episode(i)
        return obs

    def step_async(self, actions: np.ndarray) -> None:
        self._actions = np.asarray(actions, dtype=np.uint8).reshape(self.num_envs)

    def step_wait(self):
        self._send_step()
        return self._recv_step()

    def _send_step(self) -> None:
        self.conn.send(bytes([CMD_STEP]) + self._actions.tobytes())

    def _recv_step(self):
        msg = self.conn.recv()
        n, k = self.num_envs, len(self.fields)
        obs, off = self._obs(msg, 0)
        events = np.frombuffer(msg, np.float32, n * k, off).reshape(n, k)
        off += n * k * 4
        terminated = np.frombuffer(msg, np.uint8, n, off).astype(bool); off += n
        truncated = np.frombuffer(msg, np.uint8, n, off).astype(bool); off += n
        cause = np.frombuffer(msg, np.uint8, n, off); off += n
        seeds = np.frombuffer(msg, np.uint32, n, off); off += 4 * n
        (n_done,) = struct.unpack_from("<H", msg, off); off += 2
        terminal = {}
        for _ in range(n_done):
            (i,) = struct.unpack_from("<H", msg, off); off += 2
            terminal[i] = np.frombuffer(msg, np.float32, self.obs_size, off).copy(); off += 4 * self.obs_size
        if off != len(msg):
            raise ValueError(f"step reply has {len(msg) - off} unexpected bytes (protocol mismatch)")

        f, a = self._f, self._actions
        derived = self._derived(events, a)  # uses _last_obs = what the agent saw when it chose `a`
        event_terms = events * self._w  # per-decision events only (totals have weight 0)
        rewards = event_terms.sum(axis=1)
        for name, values in derived.items():
            rewards = rewards + self._derived_w[name] * values
        dones = terminated | truncated
        infos = []
        for i in range(n):
            terms = {name: float(event_terms[i, f[name]]) for name in self._event_terms}
            terms.update({name: float(self._derived_w[name] * values[i]) for name, values in derived.items()})
            info = {"reward_terms": terms}
            if dones[i]:
                info["terminal_observation"] = terminal[i]
                info["TimeLimit.truncated"] = bool(truncated[i] and not terminated[i])
                meters_total = float(events[i, f["meters"]])
                per100 = 100.0 / max(meters_total, 1.0)
                c = {k: int(v[i]) for k, v in self._count.items()}
                info["episode_end"] = {
                    "seed": int(seeds[i]), "score": float(events[i, f["score"]]), "meters": meters_total,
                    "ticks": int(events[i, f["ticks"]]), "death_cause": self.death_causes[cause[i]] if terminated[i] else "",
                    **c, "moves_per_100m": c["moves"] * per100, "reversals_per_100m": c["reversals"] * per100,
                    "pointless_per_100m": c["pointless"] * per100,
                }
                self._new_episode(i)
            infos.append(info)
        self._last_obs = obs
        return obs, rewards.astype(np.float32), dones, infos

    def _layout(self, lay: dict) -> None:
        """Where, in an observation, the lane grid and the runner's lane are."""
        rows, ch = lay["rows"], len(lay["channels"])
        self._grid_shape = (lay["lanes"], rows, ch)
        self._lane_at = lay["lanes"] * rows * ch + lay["state"].index("lane0")  # lane one-hot starts here
        row_start = lay["first_row_offset_mm"] + np.arange(rows) * lay["row_len_mm"]
        self._reach_rows = np.flatnonzero((row_start + lay["row_len_mm"] > 0) & (row_start < REACH_MM))
        self._obstacle_ch = [j for j, name in enumerate(lay["channels"]) if name not in NOT_OBSTACLES]

    def _derived(self, events: np.ndarray, a: np.ndarray) -> dict[str, np.ndarray]:
        """The derived reward terms of this decision (0/1 per env), and the episode counters."""
        f, n = self._f, self.num_envs
        moved = (a != NOTHING).astype(np.float32)
        turned = events[:, f["laneChanges"]] > 0
        turn_dir = np.where(a == LEFT, -1, np.where(a == RIGHT, 1, 0)).astype(np.int8)
        turned &= turn_dir != 0  # only lane changes the agent asked for (not a bounce back after a side hit)
        reversed_ = turned & (self._last_turn == -turn_dir) & (self._t - self._last_turn_t <= REVERSE_DECISIONS)
        self._last_turn = np.where(turned, turn_dir, self._last_turn)
        self._last_turn_t = np.where(turned, self._t, self._last_turn_t)

        started = ((a == JUMP) & (events[:, f["jumps"]] > 0)) | ((a == ROLL) & (events[:, f["rolls"]] > 0))
        grid = self._last_obs[:, : np.prod(self._grid_shape)].reshape(n, *self._grid_shape)
        lane = self._last_obs[:, self._lane_at: self._lane_at + self._grid_shape[0]].argmax(axis=1)
        ahead = grid[np.arange(n), lane][:, self._reach_rows][:, :, self._obstacle_ch]  # (n, rows in reach, obstacle channels)
        pointless = started & (ahead.max(axis=(1, 2)) == 0)

        self._t += 1
        self._count["moves"] += moved.astype(np.int64)
        self._count["reversals"] += reversed_
        self._count["pointless"] += pointless
        self._count["jumps"] += events[:, f["jumps"]].astype(np.int64)
        self._count["rolls"] += events[:, f["rolls"]].astype(np.int64)
        self._count["laneChanges"] += events[:, f["laneChanges"]].astype(np.int64)
        return {
            "meters": events[:, f["distance"]] / 1000.0,
            "moves": moved,
            "reversals": reversed_.astype(np.float32),
            "pointlessJumpsRolls": pointless.astype(np.float32),
        }

    def _new_episode(self, i: int) -> None:
        self._t[i] = 0
        self._last_turn[i] = 0
        self._last_turn_t[i] = -10**9
        for v in self._count.values():
            v[i] = 0

    def close(self) -> None:
        try:
            self.conn.send(bytes([CMD_CLOSE]))
        finally:
            self.conn.close()

    # --- extras -------------------------------------------------------------------------------
    def set_seed(self, env: int, seed: int) -> np.ndarray:
        """Restart game `env` on exactly this seed (benchmarks, progress races). Returns its first obs."""
        self.conn.send(bytes([CMD_SEED]) + struct.pack("<HI", env, seed))
        obs = np.frombuffer(self.conn.recv(), np.float32, self.obs_size).copy()
        self._last_obs[env] = obs
        self._new_episode(env)
        return obs

    def replay(self, env: int) -> dict:
        """The replay of game `env`'s most recently finished episode."""
        self.conn.send(bytes([CMD_REPLAY]) + struct.pack("<H", env))
        return json.loads(self.conn.recv())

    def _obs(self, msg: bytes, off: int) -> tuple[np.ndarray, int]:
        size = self.num_envs * self.obs_size
        return np.frombuffer(msg, np.float32, size, off).reshape(self.num_envs, self.obs_size).copy(), off + 4 * size

    # SB3 requires these; the server owns the games, so there are no Python-side attributes to reach.
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


class MultiRunnerVecEnv(VecEnv):
    """Several server processes as one VecEnv: send every server its actions first, then collect all
    replies, so the servers step their games in parallel (one Node process per CPU core)."""

    def __init__(self, envs: list[RunnerVecEnv]):
        self.envs = envs
        self._cuts = np.cumsum([0] + [e.num_envs for e in envs])
        super().__init__(int(self._cuts[-1]), envs[0].observation_space, envs[0].action_space)

    def reset(self):
        for e in self.envs:
            e._send_reset()  # every server resets in parallel
        return np.concatenate([e._recv_reset() for e in self.envs])

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

