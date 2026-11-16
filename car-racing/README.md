# The car that taught itself to drive

PPO (Stable-Baselines3) learning Gymnasium's **CarRacing-v3** from pixels, and a fair way to compare
reward ideas: every model drives the same 100 tracks with the game's own score.

> **New to this code?** Open this folder with an AI coding agent (Claude Code, Cursor, GitHub
> Copilot or similar) and ask it to walk you through it. For example: *"Explain how train.py,
> wrappers.py and bench.py fit together, what each reward idea changes, and how I train and
> benchmark a run on my laptop."*

## What's here

- `train.py`: PPO training (64×64 gray frames, a stack of 2 or 4, RL Zoo's tuned settings). Every
  100,000 steps it saves a checkpoint and races one fixed track, with a video.
- `wrappers.py`: the reward ideas, each a switch: grass penalty, centre band (narrow on straights,
  the whole road before curves), speed bonus along the track, steering smoothness.
- `bench.py`: the benchmark. Final models × 100 fixed tracks, deterministic, game score only, so the
  training rewards play no part in the comparison.
- `runs.json`: every run's number, what it changed and its settings.
- `dashboard/`: a local page with training curves, compare-runs and benchmark views.

## Run it

```
python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python train.py --run-name baseline
.venv/bin/python train.py --run-name mine --grass-penalty 0.1 --band-penalty 0.05 --speed-bonus 0.05 --steer-penalty 0.1
.venv/bin/python bench.py baseline mine --episodes 100 --workers 8
.venv/bin/python dashboard/export.py && open dashboard/index.html   # or serve the folder
```

## What I found (100 tracks each, mean ± 95% CI)

| # | Run | Score |
|---|---|---|
| 1 | the game's own reward | 540 ± 34 |
| 2 | + grass penalty | 623 ± 35 |
| 3 | + centre band + small speed bonus | 694 ± 36 |
| 4 | + steering smoothness | **742 ± 31** |
| 5 | run 4 with a 4× bigger speed bonus | 729 ± 31 |
| 6 | run 4 without the speed bonus | 667 ± 35 |
| 7 | run 4 with 4 frames instead of 2 | 617 ± 40 |

Each change was tested against the previous best on the same tracks (paired). The biggest lesson:
the cars were limited by speed in corners, not by crashes, and a bigger reward for speed did not
make them faster.

Code: MIT, see the [licence](../LICENSE).
