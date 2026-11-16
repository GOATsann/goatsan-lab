"""Benchmark a trained runner model on the same fixed seeds every time, scored by the game's own score.

    cd runner && ../car-racing/.venv/bin/python train/bench.py r1-distance

Every seed is played once with deterministic actions, all at once on one game server (one game per
seed). The training reward plays no part. Writes runs/<run>/bench.csv (one row per seed) and saves
the replays of the best, median and worst seed to runs/<run>/bench-replays/ for rendering.
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from runner_env import RunnerVecEnv  # noqa: E402
from train import GAME_OPTIONS, MAX_TICKS, GameServers  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("run")
    p.add_argument("--episodes", type=int, default=100)
    p.add_argument("--seed-start", type=int, default=1000)
    p.add_argument("--port", type=int, default=7900)
    p.add_argument("--out", default="bench.csv", help="file name inside runs/<run>/ (use another name for quick checks)")
    args = p.parse_args()

    run_dir = ROOT / "runs" / args.run
    out = run_dir / args.out
    if out.exists() and args.out == "bench.csv" and args.episodes < 100:
        raise SystemExit(f"refusing to replace {out} with a {args.episodes}-seed result; use --out for quick checks")
    model = PPO.load(run_dir / "final.zip", device="cpu")  # training normalizes rewards only, so raw obs go in
    seeds = list(range(args.seed_start, args.seed_start + args.episodes))

    started = time.time()
    servers = GameServers(1, args.port, run_dir / "logs")
    try:
        meta = json.loads((run_dir / "meta.json").read_text())
        options = meta.get("game_options", GAME_OPTIONS)  # the rules the model was trained on
        env = RunnerVecEnv(servers.ports[0], n_envs=len(seeds), seed_base=10**9, max_ticks=MAX_TICKS, options=options)
        if env.version != meta["game_version"]:
            raise SystemExit(f"model trained on game version {meta['game_version']}, server is version {env.version}")
        obs = np.stack([env.set_seed(i, s) for i, s in enumerate(seeds)])
        results: dict[int, dict] = {}
        replays: dict[int, dict] = {}
        while len(results) < len(seeds):
            actions, _ = model.predict(obs, deterministic=True)
            obs, _, done, infos = env.step(actions)
            for i in np.flatnonzero(done):
                if i not in results:  # later episodes in this game slot are the seed stream: ignore them
                    results[i] = infos[i]["episode_end"]
                    replays[i] = env.replay(int(i))
        env.close()
    finally:
        servers.stop()

    rows = []
    for i, s in enumerate(seeds):
        e = results[i]
        assert e["seed"] == s, (e["seed"], s)
        rows.append({"seed": s, "score": e["score"], "meters": e["meters"], "coin_score": e["score"] - e["meters"],
                     "seconds": round(e["ticks"] / 60, 2), "death_cause": e["death_cause"] or "time limit",
                     "moves_per_100m": round(e["moves_per_100m"], 2), "reversals_per_100m": round(e["reversals_per_100m"], 2),
                     "pointless_per_100m": round(e["pointless_per_100m"], 2), "jumps": e["jumps"], "rolls": e["rolls"],
                     "lane_changes": e["laneChanges"]})
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    order = sorted(range(len(rows)), key=lambda i: rows[i]["score"])
    keep = {"worst": order[0], "median": order[len(order) // 2], "best": order[-1]}
    (run_dir / "bench-replays").mkdir(exist_ok=True)
    for label, i in keep.items():
        (run_dir / "bench-replays" / f"{label}-seed{rows[i]['seed']}.json").write_text(json.dumps(replays[i]))

    score = np.array([r["score"] for r in rows])
    causes = {}
    for r in rows:
        causes[r["death_cause"]] = causes.get(r["death_cause"], 0) + 1
    print(f"{args.run}: mean {score.mean():.1f} ± {1.96 * score.std(ddof=1) / np.sqrt(len(score)):.1f} (95% CI)  "
          f"median {np.median(score):.0f}  worst {score.min():.0f}  best {score.max():.0f}")
    print("deaths:", ", ".join(f"{c} {n}" for c, n in sorted(causes.items(), key=lambda kv: -kv[1])))
    print(f"{len(rows)} seeds in {(time.time() - started) / 60:.1f} min -> {out}")


if __name__ == "__main__":
    main()
