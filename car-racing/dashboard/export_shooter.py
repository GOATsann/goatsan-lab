"""Gather the Shooter Z training runs into dashboard/data-shooter.json (same shape as data-runner.json).

    car-racing/.venv/bin/python car-racing/dashboard/export_shooter.py
Reads shooter-z-fps/runs/<run>/: TensorBoard logs, progress.csv (the progress benchmark vs Normal bots),
stages.csv (curriculum), meta.json and bench.json. Cloud runs are copied in by runs/cloud/fetch_when_done.sh.
Local test runs (t*-, zz-) are left out.
"""

import csv
import json
import time
from pathlib import Path

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

LAB = Path(__file__).resolve().parents[2]
RUNS = LAB / "shooter-z-fps" / "runs"
OUT = Path(__file__).resolve().parent / "data-shooter.json"
PCT = {"win_rate", "hit_rate", "headshot_share", "cut_off_share", "eval_win"}
TAGS = {
    "episode/win_rate": "win_rate",  # training matches, all opponents of the moment
    "episode/kd": "kd",
    "episode/hit_rate": "hit_rate",
    "episode/headshot_share": "headshot_share",
    "episode/damage_per_min": "damage_per_min",
    "episode/cut_off_share": "cut_off_share",
    "reward/enemyVisible": "enemy_visible",
    "train/stage": "stage",
    "train/helper_scale": "helper_scale",
    "train/explained_variance": "coach_accuracy",
    "train/entropy_loss": "exploration",
    "train/clip_fraction": "clipped_share",
    "train/approx_kl": "update_size",
    "train/value_loss": "coach_loss",
    "time/fps": "fps",
}


def scalars(run_dir: Path, weight: float) -> dict[str, list[list[float]]]:
    out: dict[str, list[list[float]]] = {}
    for events in sorted(run_dir.glob("tb/**/events.out.tfevents.*")):
        ea = EventAccumulator(str(events), size_guidance={"scalars": 0})
        ea.Reload()
        for tag in ea.Tags().get("scalars", []):
            key = TAGS.get(tag)
            if key:
                out.setdefault(key, []).extend([[e.step, e.value] for e in ea.Scalars(tag)])
    for key in out:
        out[key] = sorted({step: [step, value] for step, value in out[key]}.values())
    for key in PCT & out.keys():
        out[key] = [[s, v * 100] for s, v in out[key]]
    if "exploration" in out:  # SB3 logs -entropy
        out["exploration"] = [[s, -v] for s, v in out["exploration"]]
    if "enemy_visible" in out and weight:  # reward per decision -> share of decisions with an enemy on screen
        out["enemy_visible"] = [[s, v / weight * 100] for s, v in out["enemy_visible"]]
    # the step counter for the progress bar (the generic page reads practice_score)
    out["practice_score"] = out.get("win_rate", [])
    return out


def evals(run_dir: Path) -> list[dict]:
    """The progress benchmark (32 fixed matches vs Normal bots) as the page's 'races' (score = win %)."""
    log = run_dir / "progress.csv"
    if not log.exists():
        return []
    with log.open() as f:
        return [{"steps": int(r["steps"]), "minutes": float(r["minutes"]), "score": float(r["win_rate"]) * 100,
                 "stage": r["stage"], "kd": float(r["kd"]), "hit_rate": float(r["hit_rate"]) * 100,
                 "headshot_share": float(r["headshot_share"]) * 100, "damage_per_min": float(r["damage_per_min"])}
                for r in csv.DictReader(f)]


def stages(run_dir: Path) -> list[dict]:
    log = run_dir / "stages.csv"
    if not log.exists():
        return []
    with log.open() as f:
        return [{"steps": int(r[0]), "stage": r[1], "event": r[2]} for r in csv.reader(f) if r]


def main() -> None:
    runs = {}
    dirs = [p for p in RUNS.iterdir() if p.is_dir() and (p / "meta.json").exists() and not p.name.startswith(("t1-", "t2-", "zz-"))]
    for run_dir in sorted(dirs, key=lambda p: p.name):
        meta = json.loads((run_dir / "meta.json").read_text())
        reward = json.loads((run_dir / "reward.json").read_text()) if (run_dir / "reward.json").exists() else {}
        weight = reward.get("weights", {}).get("enemyVisible", {}).get("w", 0)
        bench = json.loads((run_dir / "bench.json").read_text()) if (run_dir / "bench.json").exists() else None
        runs[run_dir.name] = {
            "number": None, "change": "curriculum" if meta["args"].get("curriculum") else "straight self-play",
            "game_version": meta.get("game_version"), "target_steps": int(float(meta["args"]["timesteps"])),
            "series": scalars(run_dir, weight), "races": evals(run_dir), "stages": stages(run_dir),
            "videos": [], "bench_videos": [], "bench": None, "shooter_bench": bench,
        }
    OUT.write_text(json.dumps({"project": "shooter", "updated": time.strftime("%Y-%m-%d %H:%M:%S"), "runs": runs}))
    print(f"wrote {OUT} ({', '.join(runs) or 'no runs yet'})")


if __name__ == "__main__":
    main()
