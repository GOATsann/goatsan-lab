"""Round-robin between Shooter Z models: every pair plays 50 seeds from both sides (100 matches), best actions.
Ranks by average kill share against all the others (self-play models can beat one opponent and lose to another,
so one reference is not enough).

    ../car-racing/.venv/bin/python train/roundrobin.py runs/A-curriculum@28006400 runs/D-selfplay-ramp@48005120 ...
Writes runs/roundrobin.json.
"""

import argparse
import itertools
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from szpolicy import load_model  # noqa: E402
from train import MAX_TICKS, play_matches  # noqa: E402


class Det:
    def __init__(self, policy):
        self.policy = policy

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        return self.policy.predict(obs, state=state, episode_start=episode_start, deterministic=True)


def label(arg: str) -> str:
    run, _, steps = arg.partition("@")
    return f"{Path(run).name[:1]}@{int(steps) / 1e6:.0f}M" if steps else Path(run).name


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("models", nargs="+")
    p.add_argument("--seeds", type=int, default=50)
    p.add_argument("--port", type=int, default=8120)
    args = p.parse_args()
    models = {}
    for a in args.models:
        run, _, steps = a.partition("@")
        models[label(a)] = load_model(Path(run) / "final.zip", snapshot=(Path(run) / "snapshots" / f"policy_{int(steps):010d}.pt") if steps else None)
    srv = subprocess.Popen([str(ROOT / "node_modules/.bin/tsx"), "src/headless/server.ts", "--port", str(args.port)], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    pair = {}
    try:
        for a, b in itertools.combinations(models, 2):
            ka = kb = 0
            for me, opp, flip in ((a, b, False), (b, a, True)):
                rec: list = []
                play_matches(models[me].policy, args.port, "policy", args.seeds, 5000, MAX_TICKS, opponent_policy=Det(models[opp].policy), records=rec)
                k, d = sum(x["kills"] for x in rec), sum(x["deaths"] for x in rec)
                ka, kb = (ka + d, kb + k) if flip else (ka + k, kb + d)
            share = ka / max(ka + kb, 1)
            pair[(a, b)], pair[(b, a)] = share, 1 - share
            print(f"{a} vs {b}: kill share {share:.0%} ({ka:.0f} : {kb:.0f})", flush=True)
    finally:
        srv.terminate()
    names = list(models)
    avg = {n: sum(pair[(n, o)] for o in names if o != n) / (len(names) - 1) for n in names}
    worst = {n: min(pair[(n, o)] for o in names if o != n) for n in names}
    print("\nranking (average kill share vs all others, worst matchup):")
    for n in sorted(names, key=lambda n: -avg[n]):
        print(f"  {n:8s} average {avg[n]:.0%}, worst {worst[n]:.0%}")
    (ROOT / "runs" / "roundrobin.json").write_text(json.dumps(
        {"models": dict(zip(names, args.models)), "pairs": {f"{a} vs {b}": v for (a, b), v in pair.items()}, "average": avg, "worst": worst}, indent=2))


if __name__ == "__main__":
    main()
