"""Benchmark a trained runner model on the same fixed seeds every time (once per start level), scored by the game's own score.

    cd runner && ../car-racing/.venv/bin/python train/bench.py r1-distance

Every seed is played once with deterministic actions, all at once on one game server (one game per
seed). The training reward plays no part. Writes runs/<run>/bench.csv (one row per seed) and saves
the replays of the best, median and worst seed to runs/<run>/bench-replays/ for rendering.
"""

import argparse
import csv
import json
import re
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
    p.add_argument("--out", default=None, help="file name inside runs/<run>/ (default bench.csv, or bench_<steps>.csv for a checkpoint)")
    p.add_argument("--game-dir", type=Path, default=ROOT, help="runner folder whose game server to play (must match the model's version)")
    p.add_argument("--checkpoint", type=Path, help="benchmark a checkpoint .zip instead of final.zip (for easier AI opponents)")
    args = p.parse_args()

    run_dir = ROOT / "runs" / args.run
    steps = int(re.search(r"_(\d+)_steps", args.checkpoint.name).group(1)) if args.checkpoint else None
    default_out = f"bench_{steps}.csv" if steps else "bench.csv"
    out = run_dir / (args.out or default_out)
    if out.exists() and out.name == default_out and args.episodes < 100:
        raise SystemExit(f"refusing to replace {out} with a {args.episodes}-seed result; use --out for quick checks")
    model = PPO.load(args.checkpoint or run_dir / "final.zip", device="cpu")  # training normalizes rewards only, so raw obs go in
    seeds = list(range(args.seed_start, args.seed_start + args.episodes))

    started = time.time()
    meta = json.loads((run_dir / "meta.json").read_text())
    options = meta.get("game_options", GAME_OPTIONS)  # the rules the model was trained on
    servers = GameServers(1, args.port, run_dir / "logs", game_dir=args.game_dir)
    rows, replays = [], {}
    try:
        # v4+: every seed once per start level (the level of each pass is fixed, not random)
        probe = RunnerVecEnv(servers.ports[0], n_envs=1, seed_base=10**9, max_ticks=MAX_TICKS, options=options)
        levels = probe.level_names or [""]
        if probe.version != meta["game_version"]:
            raise SystemExit(f"model trained on game version {meta['game_version']}, server is version {probe.version}")
        probe.close()
        servers.stop()
        for level in levels:
            servers = GameServers(1, args.port, run_dir / "logs", game_dir=args.game_dir)  # one connection per server process
            opts = options | ({"level": level} if level else {})
            env = RunnerVecEnv(servers.ports[0], n_envs=len(seeds), seed_base=10**9, max_ticks=MAX_TICKS, options=opts)
            obs = np.stack([env.set_seed(i, s) for i, s in enumerate(seeds)])
            results: dict[int, dict] = {}
            while len(results) < len(seeds):
                actions, _ = model.predict(obs, deterministic=True)
                obs, _, done, infos = env.step(actions)
                for i in np.flatnonzero(done):
                    if i not in results:  # later episodes in this game slot are the seed stream: ignore them
                        results[i] = infos[i]["episode_end"]
                        replays[(level, seeds[i])] = env.replay(int(i))
            env.close()
            servers.stop()
            for i, s in enumerate(seeds):
                e = results[i]
                assert e["seed"] == s and e.get("level", "") == level, (e["seed"], s, e.get("level"), level)
                rows.append({"level": level, "seed": s, "score": e["score"], "meters": e["meters"],
                             "coin_score": e["score"] - e["meters"], "seconds": round(e["ticks"] / 60, 2),
                             "death_cause": e["death_cause"] or "time limit",
                             "moves_per_100m": round(e["moves_per_100m"], 2), "reversals_per_100m": round(e["reversals_per_100m"], 2),
                             "pointless_per_100m": round(e["pointless_per_100m"], 2), "jumps": e["jumps"], "rolls": e["rolls"],
                             "lane_changes": e["laneChanges"]})
    finally:
        servers.stop()

    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    (run_dir / "bench-replays").mkdir(exist_ok=True)
    for level in dict.fromkeys(r["level"] for r in rows):
        mine = sorted((r for r in rows if r["level"] == level), key=lambda r: r["score"])
        tag = (f"{steps}-" if steps else "") + (f"{level}-" if level else "")
        for label, r in {"worst": mine[0], "median": mine[len(mine) // 2], "best": mine[-1]}.items():
            (run_dir / "bench-replays" / f"{tag}{label}-seed{r['seed']}.json").write_text(json.dumps(replays[(level, r["seed"])]))
        score = np.array([r["score"] for r in mine])
        causes = {}
        for r in mine:
            causes[r["death_cause"]] = causes.get(r["death_cause"], 0) + 1
        print(f"{args.run} {level or ''}: mean {score.mean():.1f} ± {1.96 * score.std(ddof=1) / np.sqrt(len(score)):.1f} (95% CI)  "
              f"median {np.median(score):.0f}  worst {score.min():.0f}  best {score.max():.0f}  "
              f"survived 10 min {np.mean([r['death_cause'] == 'time limit' for r in mine]):.0%}")
        print("  deaths:", ", ".join(f"{c} {n}" for c, n in sorted(causes.items(), key=lambda kv: -kv[1])))
    print(f"{len(rows)} episodes in {(time.time() - started) / 60:.1f} min -> {out}")


if __name__ == "__main__":
    main()
