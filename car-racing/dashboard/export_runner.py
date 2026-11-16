"""Gather the runner's training runs into dashboard/data-runner.json (same shape as data.json).

    car-racing/.venv/bin/python car-racing/dashboard/export_runner.py
Reads runner/runs/<run>/: TensorBoard logs, progress.csv, meta.json, bench.csv and rendered videos.
"""

import csv
import json
import re
import time
from pathlib import Path

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

LAB = Path(__file__).resolve().parents[2]  # goatsan-lab/
RUNNER = LAB / "runner"
OUT = Path(__file__).resolve().parent / "data-runner.json"
# TensorBoard tag -> short key (the dashboard's chart keys)
TAGS = {
    "episode/score": "practice_score",
    "episode/ticks": "survival",
    "episode/moves_per_100m": "moves",
    "episode/reversals_per_100m": "reversals",
    "episode/pointless_per_100m": "pointless",
    "episode/score_easy": "score_easy",
    "episode/score_normal": "score_normal",
    "episode/score_hard": "score_hard",
    "death/caught": "caught_share",
    "death/train front": "train_front_share",
    "death/time limit": "time_limit_share",
    "train/explained_variance": "coach_accuracy",
    "train/entropy_loss": "exploration",
    "train/clip_fraction": "clipped_share",
    "train/approx_kl": "update_size",
    "train/value_loss": "coach_loss",
    "time/fps": "fps",
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
    if "survival" in out:  # ticks -> seconds
        out["survival"] = [[s, v / 60] for s, v in out["survival"]]
    if "exploration" in out:  # SB3 logs the entropy loss (= -entropy); show the entropy itself
        out["exploration"] = [[s, -v] for s, v in out["exploration"]]
    return out


def races(run_dir: Path) -> list[dict]:
    log = run_dir / "progress.csv"
    if not log.exists():
        return []
    with log.open() as f:
        return [{"steps": int(r["steps"]), "minutes": float(r["minutes"]), "score": float(r["score"]),
                 "seconds": float(r["seconds"]), "death": r["death_cause"]} for r in csv.DictReader(f)]


def videos(run_dir: Path) -> tuple[list[dict], list[dict]]:
    """Progress-race videos (step_*.mp4) and benchmark-seed videos (everything else)."""
    progress, bench = [], []
    for mp4 in sorted((run_dir / "videos").glob("*.mp4")):
        src = f"../../runner/runs/{run_dir.name}/videos/{mp4.name}"
        m = re.match(r"step_(\d+)\.mp4", mp4.name)
        if m:
            progress.append({"steps": int(m.group(1)), "src": src})
        else:
            bench.append({"label": mp4.stem, "src": src})
    return progress, bench


def bench(run_dir: Path) -> list[dict] | None:
    log = run_dir / "bench.csv"
    if not log.exists():
        return None
    with log.open() as f:
        return [{"seed": int(r["seed"]), "level": r.get("level", ""), "score": float(r["score"]), "meters": float(r["meters"]),
                 "seconds": float(r["seconds"]), "death": r["death_cause"], "limit": float(r.get("time_limit_min") or 10),
                 "moves": float(r["moves_per_100m"]), "reversals": float(r["reversals_per_100m"]),
                 "pointless": float(r["pointless_per_100m"])} for r in csv.DictReader(f)]


def main() -> None:
    registry = json.loads((RUNNER / "train" / "runs.json").read_text()) if (RUNNER / "train" / "runs.json").exists() else {}
    runs = {}
    dirs = [p for p in (RUNNER / "runs").iterdir() if p.is_dir() and (p / "meta.json").exists() and not p.name.startswith("zz-")]
    for run_dir in sorted(dirs, key=lambda p: (registry.get(p.name, {}).get("number", 10**6), p.stat().st_mtime)):
        meta = json.loads((run_dir / "meta.json").read_text())
        info = registry.get(run_dir.name, {})
        progress, bench_videos = videos(run_dir)
        runs[run_dir.name] = {
            "number": info.get("number"), "change": info.get("change", ""), "game_version": meta.get("game_version"),
            "target_steps": int(float(meta["args"]["timesteps"])), "series": scalars(run_dir), "races": races(run_dir),
            "videos": progress, "bench_videos": bench_videos, "bench": bench(run_dir),
        }
    data = {"project": "runner", "updated": time.strftime("%Y-%m-%d %H:%M:%S"), "runs": runs}
    OUT.write_text(json.dumps(data))
    print(f"wrote {OUT} ({', '.join(runs)})")


if __name__ == "__main__":
    main()
