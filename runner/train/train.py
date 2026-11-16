"""Train a PPO agent on the runner game. The game runs in Node servers (one per core); see PROTOCOL.md.

    cd runner && ../car-racing/.venv/bin/python train/train.py --run-name r1-distance
    ... --servers 30 --envs-per-server 64 --timesteps 50e6      # a cloud machine

Writes runs/<run>/: the model, TensorBoard logs (reward/<term> for every reward term, episode/score,
episode/meters, death/<cause> shares), progress.csv, and one replay per progress race (replays/).
reward.json is copied into the run folder, so every run records the reward it was trained with.
"""

import argparse
import csv
import json
import shutil
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback, CallbackList, CheckpointCallback
from stable_baselines3.common.vec_env import VecNormalize

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from runner_env import MultiRunnerVecEnv, RunnerVecEnv, load_reward  # noqa: E402

PROGRESS_SEED = 7  # the same track for every progress race, so they compare
MAX_TICKS = 36_000  # 10 minutes of game time per episode
# Game options sent in every handshake (rules v3+). The chaser stays hidden from the AI, like from a
# player who does not look back; benchmarks use the same options as training (from meta.json).
GAME_OPTIONS = {"powerups": True, "stumbles_to_catch": 2, "observe_chaser": False, "level": "random"}
# Progress races always start on Normal, so they compare across the run (training draws a random level).
PROGRESS_OPTIONS = GAME_OPTIONS | {"level": "normal"}


class GameServers:
    """Start N Node game servers on consecutive ports; stop them on exit."""

    def __init__(self, n: int, port0: int, log_dir: Path, game_dir: Path = ROOT):
        self.procs, self.ports = [], list(range(port0, port0 + n))
        tsx = game_dir / "node_modules" / ".bin" / "tsx"  # game_dir: a runner folder (the live one, or a frozen copy)
        log_dir.mkdir(parents=True, exist_ok=True)
        logs = [log_dir / f"server-{port}.log" for port in self.ports]
        for port, log in zip(self.ports, logs):
            with log.open("w") as f:  # a file, not a pipe: nobody reads a pipe after start-up, so it could fill and block
                self.procs.append(subprocess.Popen([str(tsx), "src/headless/server.ts", "--port", str(port)],
                                                   cwd=game_dir, stdout=f, stderr=subprocess.STDOUT))
        deadline = time.time() + 60
        for p, log in zip(self.procs, logs):
            while "runner server" not in log.read_text():  # "runner server v1 on 127.0.0.1:<port>"
                if p.poll() is not None or time.time() > deadline:
                    self.stop()
                    raise RuntimeError(f"game server did not start, see {log}")
                time.sleep(0.1)

    def stop(self) -> None:
        for p in self.procs:
            p.terminate()
        for p in self.procs:
            p.wait(timeout=10)


def play(env: RunnerVecEnv, model: PPO, norm: VecNormalize | None, seed: int) -> dict:
    """One deterministic episode on `seed` in game 0 of a 1-game env. Returns its episode_end."""
    obs = env.set_seed(0, seed)[None]
    while True:
        o = norm.normalize_obs(obs) if norm is not None and norm.norm_obs else obs
        action, _ = model.predict(o, deterministic=True)
        obs, _, done, infos = env.step(action)
        if done[0]:
            return infos[0]["episode_end"]


class Logging(BaseCallback):
    """Per rollout: the mean of every reward term per decision, episode results, death-cause shares."""

    def _on_rollout_start(self) -> None:
        self.terms: Counter = Counter()
        self.decisions = 0
        self.ends: list[dict] = []

    def _on_step(self) -> bool:
        for info in self.locals["infos"]:
            self.terms.update(info["reward_terms"])
            if "episode_end" in info:
                self.ends.append(info["episode_end"])
        self.decisions += len(self.locals["infos"])
        return True

    def _on_rollout_end(self) -> None:
        for name, total in self.terms.items():
            self.logger.record(f"reward/{name}", total / max(self.decisions, 1))
        if self.ends:
            for key in ("score", "meters", "ticks", "moves_per_100m", "reversals_per_100m", "pointless_per_100m",
                        "jumps", "rolls", "laneChanges"):
                self.logger.record(f"episode/{key}", float(np.mean([e[key] for e in self.ends])))
            for level in sorted({e["level"] for e in self.ends} - {""}):
                mine = [e for e in self.ends if e["level"] == level]
                self.logger.record(f"episode/score_{level}", float(np.mean([e["score"] for e in mine])))
            causes = Counter(e["death_cause"] or "time limit" for e in self.ends)
            for cause, n in causes.items():
                self.logger.record(f"death/{cause}", n / len(self.ends))
            self.logger.record("episode/count", len(self.ends))


class ProgressRaces(BaseCallback):
    """Every `every` steps: one deterministic race on PROGRESS_SEED, its replay, and a CSV row."""

    def __init__(self, every: int, port: int, run_dir: Path, norm: VecNormalize):
        super().__init__()
        self.every, self.run_dir, self.norm = every, run_dir, norm
        self.env = RunnerVecEnv(port, n_envs=1, seed_base=10**9, max_ticks=MAX_TICKS, options=PROGRESS_OPTIONS)
        self.next_at = 0
        self.started = time.time()
        (run_dir / "replays").mkdir(parents=True, exist_ok=True)

    def _race(self) -> None:
        steps = self.num_timesteps
        end = play(self.env, self.model, self.norm, PROGRESS_SEED)
        replay = self.env.replay(0)
        (self.run_dir / "replays" / f"step_{steps:010d}.json").write_text(json.dumps(replay))
        self.logger.record("eval/progress_score", end["score"])
        log = self.run_dir / "progress.csv"
        new = not log.exists()
        with log.open("a", newline="") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["steps", "minutes", "score", "meters", "seconds", "death_cause",
                            "moves_per_100m", "reversals_per_100m", "pointless_per_100m"])
            w.writerow([steps, round((time.time() - self.started) / 60, 1), end["score"], end["meters"],
                        round(end["ticks"] / 60, 1), end["death_cause"] or "time limit",
                        round(end["moves_per_100m"], 2), round(end["reversals_per_100m"], 2), round(end["pointless_per_100m"], 2)])
        print(f"[race] steps={steps:,} score={end['score']:.0f} m={end['meters']:.0f} "
              f"died={end['death_cause'] or 'no (time limit)'}", flush=True)

    def _on_training_start(self) -> None:
        self._race()
        self.next_at = self.every

    def _on_step(self) -> bool:
        if self.num_timesteps >= self.next_at:
            self._race()
            self.next_at += self.every
        return True

    def _on_training_end(self) -> None:
        self._race()
        self.env.close()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run-name", required=True)
    p.add_argument("--timesteps", type=float, default=20e6, help="decisions to train for (15 per game second)")
    p.add_argument("--servers", type=int, default=4, help="Node game servers (one per core)")
    p.add_argument("--envs-per-server", type=int, default=64)
    p.add_argument("--threads", type=int, default=4, help="CPU threads for the network")
    p.add_argument("--port", type=int, default=7100, help="first port; servers use consecutive ports")
    p.add_argument("--progress-every", type=float, default=1e6)
    p.add_argument("--reward", type=Path, default=HERE / "reward.json")
    args = p.parse_args()

    torch.set_num_threads(args.threads)
    run_dir = ROOT / "runs" / args.run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(args.reward, run_dir / "reward.json")
    reward = load_reward(args.reward)

    servers = GameServers(args.servers + 1, args.port, run_dir / "logs")  # +1: the progress-race server
    try:
        env = MultiRunnerVecEnv([
            RunnerVecEnv(port, n_envs=args.envs_per_server, seed_base=1_000_000 + i * 10_000_000,
                         max_ticks=MAX_TICKS, reward=reward, options=GAME_OPTIONS)
            for i, port in enumerate(servers.ports[:-1])
        ])
        (run_dir / "meta.json").write_text(json.dumps({
            "game_version": env.envs[0].version, "obs_size": env.envs[0].obs_size, "game_options": GAME_OPTIONS,
            "server_rules": env.envs[0].hello.get("rules"), "args": vars(args) | {"reward": str(args.reward)},
        }, indent=2, default=str))
        env = VecNormalize(env, norm_obs=False, norm_reward=True, gamma=0.99)

        n_envs = env.num_envs
        model = PPO(
            "MlpPolicy", env,
            n_steps=max(16, 32_768 // n_envs),  # ~32k decisions per update, whatever the number of games
            batch_size=4096, n_epochs=4, gamma=0.99, gae_lambda=0.95, clip_range=0.2,
            ent_coef=0.01, vf_coef=0.5, max_grad_norm=0.5, learning_rate=3e-4,
            policy_kwargs=dict(net_arch=dict(pi=[256, 256], vf=[256, 256])),
            tensorboard_log=str(run_dir / "tb"), device="cpu", verbose=1,
        )
        every = int(args.progress_every)
        model.learn(
            total_timesteps=int(args.timesteps),
            callback=CallbackList([
                Logging(),
                ProgressRaces(every, servers.ports[-1], run_dir, env),
                CheckpointCallback(save_freq=max(1, every // n_envs), save_path=str(run_dir / "checkpoints"),
                                   name_prefix="ppo", save_vecnormalize=True),
            ]),
            tb_log_name="ppo",
        )
        model.save(run_dir / "final")
        env.save(str(run_dir / "final_vecnormalize.pkl"))
        env.close()
        print("done:", run_dir / "final.zip")
    finally:
        servers.stop()


if __name__ == "__main__":
    main()
