"""Play one match between two models and render it seen from above (an mp4), to watch what they do.

    ../car-racing/.venv/bin/python train/watch_topdown.py runs/A-curriculum@28006400 runs/A-curriculum@28006400 --map base

Each robot: a dot (its colour), a view cone (where it looks), a health bar, a trail of the last 3 s.
Red flash = it took damage. The score is from the observations (first to 10). Best actions only.
Models: <run> (final.zip) or <run>@<steps> (a snapshot). Writes videos/topdown_<map>_<seed>.mp4.
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import Rectangle, Wedge  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from szenv import ShooterVecEnv, enemy_visible  # noqa: E402
from szpolicy import load_model  # noqa: E402

SELF = 2874 - 28  # start of the self block (SELF_FEATURES in src/core/obs.ts)
F = {k: SELF + i for i, k in enumerate(["alive", "health", "ammo", "reloading", "fireCooldown", "protected", "vxLocal", "vzLocal", "vy",
                                         "grounded", "crouch", "pitch", "dmgSin", "dmgCos", "dmgAge", "x", "z", "yawSin", "yawCos",
                                         "teamScore", "bestEnemyScore"])}
COLORS = ["#2f9bff", "#ff9a1f"]  # robot 0 / robot 1


def model_for(arg: str):
    run, _, steps = arg.partition("@")
    snap = Path(run) / "snapshots" / f"policy_{int(steps):010d}.pt" if steps else None
    return load_model(Path(run) / "final.zip", snapshot=snap)


class Det:
    def __init__(self, m):
        self.policy = m.policy

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        return self.policy.predict(obs, state=state, episode_start=episode_start, deterministic=True)


def record(m0, m1, port: int, map_id: str, seed: int, max_ticks: int) -> list[dict]:
    env = ShooterVecEnv(port, 1, opponent="frozen", frozen=Det(m1), seed_base=seed, max_ticks=max_ticks, options={"map": map_id})
    both = env.set_seed(0, seed)
    env._last_obs = both.copy()
    env.frozen_start = np.ones(1, dtype=bool)
    obs, state, start, frames = both[:1], None, np.ones(1, dtype=bool), []
    while True:
        view = env._last_obs  # both robots' observations
        frames.append({"x": view[:, F["x"]] * 25, "z": view[:, F["z"]] * 25, "sin": view[:, F["yawSin"]], "cos": view[:, F["yawCos"]],
                       "hp": view[:, F["health"]] * 100, "alive": view[:, F["alive"]], "dmg_age": view[:, F["dmgAge"]],
                       "sees": enemy_visible(view), "score": view[:, F["teamScore"]] * 10})
        a, state = m0.policy.predict(obs, state=state, episode_start=start, deterministic=True)
        obs, _, done, infos = env.step(a)
        start = done
        if done[0]:
            frames[-1]["end"] = infos[0]["episode_end"]
            break
    env.close()
    return frames


def render(frames: list[dict], map_def: dict, out: Path, title: str, speed: float) -> None:
    tmp = out.with_suffix("")
    tmp.mkdir(parents=True, exist_ok=True)
    b = map_def["bounds"]
    fps, step = 20, 1  # 20 decisions per second of game; `speed`x faster in the video
    every = max(1, int(round(speed)))
    fig, ax = plt.subplots(figsize=(7.2, 7.2 * (b["z1"] - b["z0"]) / (b["x1"] - b["x0"]) + 0.6), dpi=150)
    fig.patch.set_facecolor("#10141b")
    for k, i in enumerate(range(0, len(frames), every * step)):
        f = frames[i]
        ax.clear()
        ax.set_facecolor("#1b2130")
        ax.set_xlim(b["x0"], b["x1"]); ax.set_ylim(b["z1"], b["z0"])  # z down = like a map
        ax.set_aspect("equal"); ax.axis("off")
        ax.add_patch(Rectangle((b["x0"], b["z0"]), b["x1"] - b["x0"], b["z1"] - b["z0"], color="#1f2738", lw=0))  # the floor
        for box in map_def["boxes"]:
            if box["y0"] > 1.0:  # ceilings and overhead beams don't block at body height
                continue
            ax.add_patch(Rectangle((box["x0"], box["z0"]), box["x1"] - box["x0"], box["z1"] - box["z0"],
                                   color="#56607a" if box["kind"] == 1 else "#3a4459", lw=0))
        for r in range(2):
            trail = frames[max(0, i - 60): i + 1]
            ax.plot([t["x"][r] for t in trail if t["alive"][r]], [t["z"][r] for t in trail if t["alive"][r]], color=COLORS[r], lw=1, alpha=0.45)
            if not f["alive"][r]:
                continue
            x, z = f["x"][r], f["z"][r]
            # forward = (-sin yaw, -cos yaw); in this plot (z down) that is the angle below
            heading = np.degrees(np.arctan2(-f["cos"][r], -f["sin"][r]))
            ax.add_patch(Wedge((x, z), 7, heading - 50, heading + 50, color=COLORS[r], alpha=0.22 if not f["sees"][r] else 0.45, lw=0))
            hit = f["dmg_age"][r] < 0.1
            ax.plot(x, z, "o", ms=8, color="#ff3b3b" if hit else COLORS[r], mec="white", mew=1)
            ax.add_patch(Rectangle((x - 2, z - 2.6), 4, 0.7, color="#3a1f24", lw=0))
            ax.add_patch(Rectangle((x - 2, z - 2.6), 4 * f["hp"][r] / 100, 0.7, color="#5ee07a", lw=0))
        t = i / fps
        ax.set_title(f"{title}    blue {int(f['score'][0])} : {int(f['score'][1])} orange    {int(t // 60)}:{int(t % 60):02d}", color="white", fontsize=11, loc="left")
        fig.savefig(tmp / f"{k:05d}.png", facecolor=fig.get_facecolor())
    plt.close(fig)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "%05d.png"),
                    "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", str(out)], check=True)
    for p in tmp.glob("*.png"):
        p.unlink()
    tmp.rmdir()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("blue")
    p.add_argument("orange")
    p.add_argument("--map", default="base", choices=["base", "ship"])
    p.add_argument("--seed", type=int, default=4242)
    p.add_argument("--minutes", type=float, default=5)
    p.add_argument("--speed", type=float, default=2, help="video speed (2 = twice real time)")
    p.add_argument("--port", type=int, default=7880)
    p.add_argument("--maps-json", type=Path, required=True, help="map layouts (dumped from src/core/maps.ts)")
    args = p.parse_args()
    tsx = ROOT / "node_modules" / ".bin" / "tsx"
    srv = subprocess.Popen([str(tsx), "src/headless/server.ts", "--port", str(args.port)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(3)
        frames = record(model_for(args.blue), model_for(args.orange), args.port, args.map, args.seed, int(args.minutes * 60 * 60))
    finally:
        srv.terminate()
    end = frames[-1].get("end", {})
    out = ROOT / "videos" / f"topdown_{args.map}_{args.seed}.mp4"
    out.parent.mkdir(exist_ok=True)
    render(frames, json.loads(args.maps_json.read_text())[args.map], out, f"{args.map} map", args.speed)
    sees = np.array([f["sees"] for f in frames])
    gap = np.array([np.hypot(f["x"][0] - f["x"][1], f["z"][0] - f["z"][1]) for f in frames])
    print(f"{out}: {len(frames) / 20:.0f} s of game; blue {end.get('kills', 0):.0f} kills, {end.get('deaths', 0):.0f} deaths; "
          f"{'blue won' if end.get('won') else 'orange won' if end.get('lost') else 'no winner (time limit)'}; "
          f"enemy on screen: blue {sees[:, 0].mean():.0%}, orange {sees[:, 1].mean():.0%}; gap between them: median {np.median(gap):.0f} m")


if __name__ == "__main__":
    main()
