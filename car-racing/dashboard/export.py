"""Gather a run's numbers into dashboard/data.json for the local dashboard.

    .venv/bin/python dashboard/export.py            # every run under runs/
Reads each run's TensorBoard log, progress.csv and the list of progress videos.
"""

import csv
import json
import re
import time
from pathlib import Path

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

ROOT = Path(__file__).resolve().parent.parent
# The TensorBoard series the dashboard shows (tag -> short key).
TAGS = {
    "rollout/ep_rew_mean": "practice_score",
    "train/explained_variance": "coach_accuracy",
    "train/std": "exploration",
    "train/clip_fraction": "clipped_share",
    "train/approx_kl": "update_size",
    "train/value_loss": "coach_loss",
    "train/policy_gradient_loss": "driver_loss",
    "time/fps": "fps",
    "advantage/raw_abs_mean": "advantage_size",
}


def scalars(run_dir: Path) -> dict[str, list[list[float]]]:
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
    return out


def races(run_dir: Path) -> list[dict]:
    log = run_dir / "progress.csv"
    if not log.exists():
        return []
    with log.open() as f:
        return [{"steps": int(r["steps"]), "minutes": float(r["minutes"]), "score": float(r["test_race_score"])} for r in csv.DictReader(f)]


def bench(run_dir: Path) -> list[dict] | None:
    """Rows of bench.py's fixed-track benchmark, if it has been run for this model."""
    log = run_dir / "bench.csv"
    if not log.exists():
        return None
    with log.open() as f:
        return [
            {"seed": int(r["seed"]), "return": float(r["return"]), "frames": int(r["frames"]),
             "tiles": float(r["tiles_visited"]), "lap": int(r["lap_completed"]), "wrong_way": float(r["wrong_way_share"])}
            for r in csv.DictReader(f)
        ]


def videos(run: str) -> list[dict]:
    folder = ROOT / "videos" / run
    found = []
    for mp4 in sorted(folder.glob("step_*.mp4")):
        m = re.match(r"step_(\d+)\.mp4", mp4.name)
        if m:
            found.append({"steps": int(m.group(1)), "src": f"../videos/{run}/{mp4.name}"})
    return found


def main() -> None:
    # runs.json: each run's number, what it changed, and its training flags (the lab notebook)
    registry = json.loads((ROOT / "runs.json").read_text()) if (ROOT / "runs.json").exists() else {}
    runs = {}
    dirs = [p for p in (ROOT / "runs").iterdir() if p.is_dir()]
    for run_dir in sorted(dirs, key=lambda p: (registry.get(p.name, {}).get("number", 10**6), p.name)):
        info = registry.get(run_dir.name, {})
        runs[run_dir.name] = {"number": info.get("number"), "change": info.get("change", ""),"series": scalars(run_dir), "races": races(run_dir), "videos": videos(run_dir.name), "bench": bench(run_dir)}
    data = {"updated": time.strftime("%Y-%m-%d %H:%M:%S"), "target_steps": 4_000_000, "solved_score": 900, "runs": runs}
    out = ROOT / "dashboard" / "data.json"
    out.write_text(json.dumps(data))
    print(f"wrote {out} ({', '.join(runs)})")


if __name__ == "__main__":
    main()
