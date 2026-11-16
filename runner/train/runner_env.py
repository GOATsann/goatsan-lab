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
        unknown = set(self.reward) - set(self.fields)
        if unknown:
            raise ValueError(f"reward.json names events the game does not send: {sorted(unknown)}")
        self._w = np.array([self.reward.get(f, 0.0) for f in self.fields], dtype=np.float32)
        self._w[self.fields.index("distance")] = 0.0  # distance arrives in mm; 'meters' weight applies to it
        self._meters_w = self.reward.get("meters", 0.0)
        self._actions = np.zeros(n_envs, dtype=np.uint8)
        observation_space = spaces.Box(-np.inf, np.inf, shape=(self.obs_size,), dtype=np.float32)
        super().__init__(n_envs, observation_space, spaces.Discrete(hello["n_actions"]))

    # --- VecEnv API ---------------------------------------------------------------------------
    def reset(self) -> np.ndarray:
        self.conn.send(bytes([CMD_RESET]))
        return self._obs(self.conn.recv(), 0)[0]

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

        terms = events * self._w  # per event, per env
        meters = events[:, self.fields.index("distance")] / 1000.0
        rewards = terms.sum(axis=1) + self._meters_w * meters
        dones = terminated | truncated
        f = {name: j for j, name in enumerate(self.fields)}
        infos = []
        for i in range(n):
            info = {"reward_terms": {name: float(terms[i, j]) for j, name in enumerate(self.fields) if self._w[j]}}
            info["reward_terms"]["meters"] = float(self._meters_w * meters[i])
            if dones[i]:
                info["terminal_observation"] = terminal[i]
                info["TimeLimit.truncated"] = bool(truncated[i] and not terminated[i])
                info["episode_end"] = {
                    "seed": int(seeds[i]), "score": float(events[i, f["score"]]), "meters": float(events[i, f["meters"]]),
                    "ticks": int(events[i, f["ticks"]]), "death_cause": self.death_causes[cause[i]] if terminated[i] else "",
                }
            infos.append(info)
        return obs, rewards.astype(np.float32), dones, infos

    def close(self) -> None:
        try:
            self.conn.send(bytes([CMD_CLOSE]))
        finally:
            self.conn.close()

    # --- extras -------------------------------------------------------------------------------
    def set_seed(self, env: int, seed: int) -> np.ndarray:
        """Restart game `env` on exactly this seed (benchmarks, progress races). Returns its first obs."""
        self.conn.send(bytes([CMD_SEED]) + struct.pack("<HI", env, seed))
        return np.frombuffer(self.conn.recv(), np.float32, self.obs_size).copy()

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
            e.conn.send(bytes([CMD_RESET]))
        return np.concatenate([e._obs(e.conn.recv(), 0)[0] for e in self.envs])

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

