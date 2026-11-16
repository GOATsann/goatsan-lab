"""Benchmark finished models on the same fixed set of tracks, scored by the game's own return.

    .venv/bin/python bench.py baseline grass band-speed band-speed-steer --episodes 100 --workers 30

Every model drives the same tracks (seeds --seed-start .. +episodes-1) with deterministic actions.
Only the actor is used; each run's training reward plays no part, so the numbers compare fairly.
Writes runs/<run>/bench.csv (one row per track) and prints a summary.
"""

import argparse
import csv
import time
from multiprocessing import get_context
from pathlib import Path

import numpy as np

_models: dict = {}


def _init() -> None:
    import torch

    torch.set_num_threads(1)  # one process per core


def episode(job: tuple[str, int]) -> dict:
    """One race of run `name` on track `seed`. Frame stacking matches VecFrameStack(n_stack=2)."""
    from stable_baselines3 import PPO

    from train import stacked_frames
    from wrappers import make_env

    name, seed = job
    if name not in _models:
        _models[name] = PPO.load(Path("runs") / name / "final.zip", device="cpu")
    model = _models[name]
    env = make_env(measure=True)  # measure: only records wrong-way; the reward stays the game's
    obs, _ = env.reset(seed=seed)
    n = stacked_frames(model)  # N frames, as the model was trained; stacked channels-last like VecFrameStack
    stacked = np.zeros(obs.shape[:-1] + (obs.shape[-1] * n,), dtype=obs.dtype)
    stacked[..., -obs.shape[-1]:] = obs
    ret, decisions, wrong, done = 0.0, 0, 0, False
    while not done:
        action, _ = model.predict(stacked, deterministic=True)
        obs, reward, terminated, truncated, info = env.step(action)
        stacked = np.roll(stacked, -obs.shape[-1], axis=-1)
        stacked[..., -obs.shape[-1]:] = obs
        ret += float(reward)
        decisions += 1
        wrong += bool(info.get("wrong_way"))
        done = terminated or truncated
    u = env.unwrapped
    row = {
        "run": name,
        "seed": seed,
        "return": round(ret, 2),
        "frames": int(round(u.t * 50)),  # u.t is game time in seconds, 50 frames a second
        "tiles_visited": round(u.tile_visited_count / len(u.track), 4),
        "lap_completed": int(bool(u.new_lap) or u.tile_visited_count == len(u.track)),
        "wrong_way_share": round(wrong / max(decisions, 1), 4),
    }
    env.close()
    return row


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("runs", nargs="+")
    p.add_argument("--episodes", type=int, default=100)
    p.add_argument("--seed-start", type=int, default=1000)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--out", default="bench.csv", help="file name inside runs/<run>/ (use another name for quick checks)")
    args = p.parse_args()

    seeds = range(args.seed_start, args.seed_start + args.episodes)
    jobs = [(r, s) for r in args.runs for s in seeds]
    started = time.time()
    with get_context("spawn").Pool(args.workers, initializer=_init) as pool:
        rows = pool.map(episode, jobs, chunksize=max(1, len(jobs) // (args.workers * 4)))
    for name in args.runs:
        mine = sorted((r for r in rows if r["run"] == name), key=lambda r: r["seed"])
        out = Path("runs") / name / args.out
        if out.exists() and args.out == "bench.csv" and len(mine) < 100:
            raise SystemExit(f"refusing to replace {out} with a {len(mine)}-track result; use --out for quick checks")
        with out.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(mine[0]))
            w.writeheader()
            w.writerows(mine)
        ret = np.array([r["return"] for r in mine])
        print(
            f"{name:18s} mean {ret.mean():6.1f} ± {ret.std(ddof=1):5.1f}  median {np.median(ret):6.1f}  "
            f"min {ret.min():6.1f}  >=900 {np.mean(ret >= 900):5.0%}  laps {np.mean([r['lap_completed'] for r in mine]):5.0%}"
        )
    print(f"{len(jobs)} episodes in {(time.time() - started) / 60:.1f} min")


if __name__ == "__main__":
    main()
