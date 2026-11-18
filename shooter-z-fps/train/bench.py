"""Benchmark Shooter Z models on fixed matches (the reward plays no part).

    ../car-racing/.venv/bin/python train/bench.py runs/A-curriculum runs/B-selfplay

Each model plays 100 matches (seeds 5000-5099, deterministic actions) against Easy, Normal and Hard bots.
With two models, they also play each other on 50 seeds, each seed twice with sides swapped (100 matches).
Reports win rate (95% interval), K/D, hit rate, headshot share, damage per minute; per-match rows go to
<run>/bench.csv and the summary to <run>/bench.json.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from szpolicy import load_model  # noqa: E402
from train import MAX_TICKS, GameServers, play_matches  # noqa: E402

SEED0 = 5000


class Deterministic:
    """The opponent model in A vs B plays its best action too (the frozen-opponent code samples)."""

    def __init__(self, policy):
        self.policy = policy

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        return self.policy.predict(obs, state=state, episode_start=episode_start, deterministic=True)


def wilson(k: int, n: int) -> tuple[float, float]:
    """95% interval for a win rate."""
    if n == 0:
        return (0.0, 0.0)
    z, p = 1.96, k / n
    d = 1 + z * z / n
    mid, half = (p + z * z / (2 * n)) / d, z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (mid - half, mid + half)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("runs", nargs="+", help="run folders; <run>@<steps> = that run's snapshot at <steps> (snapshots/policy_<steps>.pt)")
    p.add_argument("--matches", type=int, default=100)
    p.add_argument("--port", type=int, default=7700)
    p.add_argument("--model", default="final.zip", help="file inside each run folder")
    args = p.parse_args()
    servers = GameServers(1, args.port, Path(args.runs[0].partition("@")[0]) / "logs")
    try:
        specs = {}  # label -> (run folder, file stem for the results, snapshot or None)
        for arg in args.runs:
            run, _, steps = arg.partition("@")
            run = Path(run)
            if steps:
                snap = run / "snapshots" / f"policy_{int(steps):010d}.pt"
                specs[f"{run.name}@{int(steps) / 1e6:.1f}M"] = (run, f"bench_{int(steps)}", snap)
            else:
                specs[run.name] = (run, "bench", None)
        models = {}
        for label, (run, _, snap) in specs.items():
            models[label] = load_model(run / args.model, snapshot=snap)
        out: dict[str, dict] = {name: {} for name in models}
        rows: dict[str, list] = {name: [] for name in models}
        for name, m in models.items():
            for skill in ("easy", "normal", "hard"):
                rec: list = []
                res = play_matches(m.policy, args.port, skill, args.matches, SEED0, MAX_TICKS, records=rec)
                wins = sum(x["won"] for x in rec)
                res["win_ci"] = wilson(wins, len(rec))
                out[name][skill] = res
                rows[name] += [{**x, "opponent": skill} for x in rec]
                print(f"{name} vs {skill}: win {res['win_rate']:.0%} ({res['win_ci'][0]:.0%}-{res['win_ci'][1]:.0%}), K/D {res['kd']:.2f}, "
                      f"hits {res['hit_rate']:.0%}, headshots {res['headshot_share']:.0%}, damage/min {res['damage_per_min']:.0f}", flush=True)
        if len(models) == 2:
            (a, ma), (b, mb) = models.items()
            half = args.matches // 2
            for me, mm, other, om in ((a, ma, b, mb), (b, mb, a, ma)):  # every seed from both sides
                rec = []
                play_matches(mm.policy, args.port, "policy", half, SEED0, MAX_TICKS, opponent_policy=Deterministic(om.policy), records=rec)
                rows[me] += [{**x, "opponent": other} for x in rec]
            for me, other in ((a, b), (b, a)):
                rec = [x for x in rows[me] if x["opponent"] == other]
                theirs = [x for x in rows[other] if x["opponent"] == me]
                wins = sum(x["won"] for x in rec) + sum(x["lost"] for x in theirs)
                n = len(rec) + len(theirs)
                out[me][f"vs {other}"] = {"win_rate": wins / n, "win_ci": wilson(wins, n), "matches": n}
            r = out[a][f"vs {b}"]
            print(f"{a} vs {b}: {a} wins {r['win_rate']:.0%} ({r['win_ci'][0]:.0%}-{r['win_ci'][1]:.0%}) of {r['matches']} matches", flush=True)
        for name in out:  # kill share per opponent (model vs model matches mostly end at the time limit)
            for opp, res in out[name].items():
                key = opp[3:] if opp.startswith("vs ") else opp
                sub = [x for x in rows[name] if x["opponent"] == key]
                k, d = sum(x["kills"] for x in sub), sum(x["deaths"] for x in sub)
                if k + d:
                    res["kill_share"], res["kills_per_match"] = k / (k + d), k / len(sub)
        for name, (run, stem, _) in specs.items():
            (run / f"{stem}.json").write_text(json.dumps({"label": name, **out[name]}, indent=2))
            with (run / f"{stem}.csv").open("w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[name][0]))
                w.writeheader()
                w.writerows(rows[name])
    finally:
        servers.stop()


if __name__ == "__main__":
    main()
