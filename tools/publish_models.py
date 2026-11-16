"""Publish trained models to Hugging Face (models never go into this git repo).

    car-racing/.venv/bin/python tools/publish_models.py            # build staging folders, then upload
    car-racing/.venv/bin/python tools/publish_models.py --dry-run  # build and check only

Reads HF_TOKEN from .env.local (ignored by git). Every model zip is re-saved without local paths
(SB3 stores the TensorBoard folder) and without the OS line of its system info; raw run metadata
(meta.json, logs) is never uploaded.
"""

import argparse
import getpass
import io
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

from huggingface_hub import HfApi
from stable_baselines3 import PPO

LAB = Path(__file__).resolve().parents[1]
USER = "TheOnlyGoatsan"
# Local paths and this machine's account name must never reach a public upload (read at run time,
# so the name itself is not written in this public file).
FORBIDDEN = ["/Users/", "/private/", "/home/", "/var/folders/", getpass.getuser(), Path.home().name]


def token() -> str:
    for line in (LAB / ".env.local").read_text().splitlines():
        if line.startswith("HF_TOKEN="):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("HF_TOKEN missing in .env.local")


def clean_zip(src: Path, dst: Path) -> None:
    """Re-save an SB3 model without its TensorBoard path, then drop the OS line from system_info.txt."""
    model = PPO.load(src, device="cpu")
    model.tensorboard_log = None
    tmp = dst.with_suffix(".tmp.zip")
    model.save(tmp)
    with zipfile.ZipFile(tmp) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "system_info.txt":
                data = b"\n".join(l for l in data.splitlines() if not l.startswith(b"- OS:")) + b"\n"
            zout.writestr(item, data)
    tmp.unlink()


def check_clean(folder: Path) -> None:
    """Fail if any file (or any file inside a zip) mentions a local path or the account name."""
    for f in folder.rglob("*"):
        if not f.is_file():
            continue
        blobs = [f.read_bytes()]
        if f.suffix == ".zip":
            with zipfile.ZipFile(f) as z:
                blobs += [z.read(n) for n in z.namelist()]
        for b in blobs:
            for word in FORBIDDEN:
                if word.encode() in b:
                    raise SystemExit(f"{f.relative_to(folder)} contains {word!r}: not uploading")


CAR_CARD = """---
license: mit
library_name: stable-baselines3
tags: [reinforcement-learning, deep-reinforcement-learning, stable-baselines3, ppo, CarRacing-v3, gymnasium]
model-index:
- name: PPO CarRacing-v3 (shaped reward, run 4)
  results:
  - task: {type: reinforcement-learning, name: reinforcement-learning}
    dataset: {name: CarRacing-v3, type: CarRacing-v3}
    metrics:
    - {type: mean_reward, value: "742.4 +/- 156.9", name: mean_reward}
---

# PPO on CarRacing-v3, with my own reward (BULSHY.FM build #1)

A PPO agent that drives Gymnasium's `CarRacing-v3` from pixels. It is run 4 of a series where every run
changed one thing in the reward, and each one was benchmarked on the same 100 tracks.

## Benchmark

100 fixed tracks (seeds 1000-1099), deterministic actions, scored with the game's own reward
(the shaped training reward plays no part):

| Run | Mean ± 95% CI | vs the game's own reward (paired) |
|---|---|---|
| 1. the game's own reward | 540 ± 34 | — |
| **4. this model** | **742 ± 31** | **+202 ± 35 per track, better on 87 of 100** |

Median 783; 15% of tracks score 900 or more ("solved" is a mean of 900, so not solved yet).
Its main limit is speed: on 85% of tracks it runs out of the 1000-frame limit before finishing the lap.

## Training reward

The game's reward (+1000/N per new track tile, -0.1 per frame), plus per game frame:

- grass: -0.1 when no wheel touches the road
- centre band: up to -0.05 for leaving a band around the centre line (half the road on straights,
  the whole road before curves)
- speed: up to +0.05 for speed along the track, on the road only
- steering: -0.1 per unit of steering change between decisions (against wobbling)

## Setup

- Observation: 64x64 grayscale, the last 2 frames stacked, 1 decision every 2 frames.
- PPO (Stable-Baselines3 2.9.2) `CnnPolicy`, gSDE, lr 1e-4 linear to 0, n_steps 4096 total, batch 128,
  10 epochs, gamma 0.99, GAE lambda 0.95, clip 0.2, actor and critic heads of 256 (GELU),
  rewards normalized with VecNormalize. 4M decisions.

## Files

- `final.zip`: the SB3 model. `final_vecnormalize.pkl`: the reward normalization (not needed to drive).
- `bench.csv`: every benchmark track (return, frames, share of tiles visited, lap finished, wrong-way share).

To drive it you need the same observation wrappers (resize to 64x64, grayscale, skip 2 frames,
stack 2), which are in the training code: https://github.com/GOATsann/goatsan-lab.

Made by @_goatsan.
"""

RUNNER_CARD = """---
license: mit
library_name: stable-baselines3
tags: [reinforcement-learning, deep-reinforcement-learning, stable-baselines3, ppo, onnx, endless-runner]
---

# Lights-Out Surfer: the PPO runner AI

The AI opponent of **Lights-Out Surfer**, an open-source endless runner (3 lanes, trains, barriers,
coins, jump and roll) built for the BULSHY.FM series. You can race it in the browser on
theonlygoatsan.com.

## Benchmark (rules v4)

The final model plays the same 100 tracks (seeds 1000-1099) on each start level, deterministic
actions, 30-minute limit, scored with the game's own score (metres + coins):

| Start level | Mean ± 95% CI | Median survival |
|---|---|---|
| Easy | 27,478 ± 1,299 | 14 min |
| Normal | 24,296 ± 1,182 | 11.6 min |
| Hard | 20,965 ± 1,087 | 9.5 min |

The difficulty keeps rising during a run with no ceiling, so every run ends. Most end head-on into a train.

## Files

- `policy-hard.onnx` (final, 55M decisions), `policy-normal.onnx` (27.5M), `policy-easy.onnx` (15M):
  the browser opponents. Input `obs` float32 [batch, 1074], output `logits` float32 [batch, 5]
  (nothing, left, right, jump, roll); play = argmax. Each has a `.json` with its benchmark and a
  `_parity.json` with 50 observations and the actions PyTorch picks (for checking another runtime).
- `final.zip`: the SB3 model (MLP 256x256 actor and critic).
- `reward.json`: the reward it was trained with (one documented weight per game event).
- `bench.csv`: every benchmark track and level; `bench_<steps>.csv` for the two easier models.

## What it sees

What a player sees, as numbers: a grid of 3 lanes x 32 rows ahead (3 m each) with 11 object types,
plus 18 values about the runner (lane, height, speed, power-ups, difficulty). The chaser behind the
runner is hidden from it, like from a player who does not look back.

## Training

PPO (Stable-Baselines3 2.9.2), 192 games in parallel run by a Node game server, a random start level
per run, 55M decisions (about an hour on a laptop). Reward: +0.1 per metre, -1 per stumble, -10 when
the run ends, -0.02 per reversed lane change or pointless jump/roll (see `reward.json`).

Code: https://github.com/GOATsann/goatsan-lab. Made by @_goatsan.
"""


def stage(root: Path) -> dict[str, Path]:
    car = root / "car-racing-ppo"
    car.mkdir(parents=True)
    src = LAB / "car-racing" / "runs" / "band-speed-steer"
    clean_zip(src / "final.zip", car / "final.zip")
    shutil.copy(src / "final_vecnormalize.pkl", car)
    shutil.copy(src / "bench.csv", car)
    (car / "README.md").write_text(CAR_CARD)

    run = root / "lights-out-surfer-ppo"
    run.mkdir(parents=True)
    src = LAB / "runner" / "runs" / "r4-v4-long"
    clean_zip(src / "final.zip", run / "final.zip")
    models = LAB / "runner" / "public" / "models"
    for level in ("easy", "normal", "hard"):
        for ext in (".onnx", ".json"):
            shutil.copy(models / f"policy-{level}{ext}", run)
    for name, level in (("policy_parity.json", "hard"), ("policy_27498240_parity.json", "normal"), ("policy_14999040_parity.json", "easy")):
        shutil.copy(src / name, run / f"policy-{level}_parity.json")
    for name in ("reward.json", "bench.csv", "bench_14999040.csv", "bench_27498240.csv"):
        shutil.copy(src / name, run)
    (run / "README.md").write_text(RUNNER_CARD)
    return {"car-racing-ppo": car, "lights-out-surfer-ppo": run}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    root = Path(tempfile.mkdtemp(prefix="hf-stage-"))
    folders = stage(root)
    for name, folder in folders.items():
        check_clean(folder)
        size = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file()) / 1e6
        print(f"{name}: {sorted(f.name for f in folder.iterdir())} ({size:.1f} MB), no local paths")
    if args.dry_run:
        print("dry run: staged in", root)
        return
    api = HfApi(token=token())
    for name, folder in folders.items():
        repo = f"{USER}/{name}"
        api.create_repo(repo, repo_type="model", private=False, exist_ok=True)
        api.upload_folder(repo_id=repo, folder_path=str(folder), commit_message="Publish trained model, benchmark and model card")
        print(f"uploaded https://huggingface.co/{repo}")
    shutil.rmtree(root)


if __name__ == "__main__":
    sys.exit(main())
