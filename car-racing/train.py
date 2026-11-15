"""Train a PPO agent to drive Gymnasium's CarRacing from pixels.

    .venv/bin/python train.py --run-name baseline                 # the game's own reward
    .venv/bin/python train.py --run-name grass --grass-penalty 0.5 # our shaped reward
    .venv/bin/python train.py --run-name baseline --resume runs/baseline/checkpoints/ppo_400000_steps.zip

Every --checkpoint-every steps it saves the model and records one test race on a
fixed track (videos/<run>/), so the videos show the same track getting better.
Watch the score climb live with:  .venv/bin/tensorboard --logdir runs
"""

import argparse
import csv
import time
from pathlib import Path

import numpy as np
import torch
from moviepy import ImageSequenceClip
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback, CallbackList, CheckpointCallback
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecFrameStack, VecNormalize
from torch import nn

from wrappers import make_env

EVAL_SEED = 7  # the same track for every test race, so progress is comparable


def linear(start: float):
    """Learning rate that falls in a straight line to 0 by the end of training."""
    return lambda progress_left: progress_left * start


def test_race(model: PPO, video_path: Path | None) -> float:
    """Drive one race on the fixed track; return the game's own score.

    Test races always use the game's reward, so shaped runs stay comparable.
    """
    env = VecFrameStack(DummyVecEnv([lambda: make_env("rgb_array")]), n_stack=2)
    env.seed(EVAL_SEED)
    obs = env.reset()
    frames, score, done = [], 0.0, False
    while not done:
        action, _ = model.predict(obs, deterministic=True)
        obs, reward, dones, infos = env.step(action)
        score += float(reward[0])
        if video_path is not None:
            frames.append(env.venv.envs[0].render())
        done = bool(dones[0])
    env.close()
    if video_path is not None and frames:
        video_path.parent.mkdir(parents=True, exist_ok=True)
        # One decision per 2 game frames at 50 fps = 25 decisions a second.
        ImageSequenceClip(frames, fps=25).write_videofile(str(video_path), logger=None)
    return score


class AdvantageStats(BaseCallback):
    """Log the size of the raw advantages before PPO rescales them.

    PPO normalizes advantages in every batch (average 0, spread 1), so plotting
    them after that is a flat line. Their raw size shows how surprised the critic
    still is: big early on, smaller as its guesses improve.
    """

    def _on_rollout_end(self) -> None:
        adv = self.model.rollout_buffer.advantages  # raw GAE values, before normalization
        self.logger.record("advantage/raw_abs_mean", float(np.abs(adv).mean()))
        self.logger.record("advantage/raw_std", float(adv.std()))

    def _on_step(self) -> bool:
        return True


class ProgressRaces(BaseCallback):
    """At the start and every `every` steps: a test race, its video, and a CSV row."""

    def __init__(self, every: int, run_dir: Path, video_dir: Path):
        super().__init__()
        self.every, self.run_dir, self.video_dir = every, run_dir, video_dir
        self.next_at = 0
        self.started = time.time()

    def _race(self) -> None:
        steps = self.num_timesteps
        score = test_race(self.model, self.video_dir / f"step_{steps:08d}.mp4")
        minutes = (time.time() - self.started) / 60
        self.logger.record("eval/test_race_score", score)
        log = self.run_dir / "progress.csv"
        new = not log.exists()
        with log.open("a", newline="") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["steps", "minutes", "test_race_score"])
            w.writerow([steps, round(minutes, 1), round(score, 1)])
        print(f"[race] steps={steps:,} minutes={minutes:.0f} score={score:.0f}", flush=True)

    def _on_training_start(self) -> None:
        self.next_at = self.num_timesteps  # a race before any learning: the "before" video
        if self.num_timesteps == 0:
            self._race()
            self.next_at = self.every

    def _on_step(self) -> bool:
        if self.num_timesteps >= self.next_at:
            self._race()
            self.next_at += self.every
        return True


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run-name", default="baseline")
    p.add_argument("--timesteps", type=float, default=4e6, help="decisions to train for (each = 2 game frames)")
    p.add_argument("--envs", type=int, default=4, help="games running at once (keep the Mac cool: 4)")
    p.add_argument("--threads", type=int, default=4, help="CPU threads for the neural network")
    p.add_argument("--checkpoint-every", type=float, default=1e5)
    p.add_argument("--grass-penalty", type=float, default=0.0, help="0 = the game's own reward")
    p.add_argument("--resume", type=Path, default=None, help="a checkpoint .zip to continue from")
    args = p.parse_args()

    torch.set_num_threads(args.threads)
    run_dir = Path("runs") / args.run_name
    video_dir = Path("videos") / args.run_name
    ckpt_dir = run_dir / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    env = make_vec_env(
        make_env,
        n_envs=args.envs,
        vec_env_cls=SubprocVecEnv,
        env_kwargs={"grass_penalty": args.grass_penalty},
    )
    env = VecFrameStack(env, n_stack=2)  # "the last 2 frames", so it can see motion
    env = VecNormalize(env, norm_obs=False, norm_reward=True)  # keeps reward sizes steady for learning

    # Each update learns from 4096 decisions, whatever the number of games.
    n_steps = max(64, 4096 // args.envs)
    if args.resume:
        model = PPO.load(args.resume, env=env, device="cpu")
        stats = args.resume.with_name(args.resume.stem + "_vecnormalize.pkl")
        if stats.exists():
            env = VecNormalize.load(str(stats), env.venv)
            model.set_env(env)
    else:
        model = PPO(
            "CnnPolicy",
            env,
            n_steps=n_steps,
            batch_size=128,
            n_epochs=10,
            gamma=0.99,
            gae_lambda=0.95,
            clip_range=0.2,
            ent_coef=0.0,
            vf_coef=0.5,
            max_grad_norm=0.5,
            learning_rate=linear(1e-4),
            use_sde=True,  # smoother exploration for continuous controls
            sde_sample_freq=4,
            policy_kwargs=dict(
                log_std_init=-2,
                ortho_init=False,
                activation_fn=nn.GELU,
                net_arch=dict(pi=[256], vf=[256]),
            ),
            tensorboard_log=str(run_dir / "tb"),
            device="cpu",
            verbose=1,
        )

    every = int(args.checkpoint_every)
    callbacks = CallbackList(
        [
            CheckpointCallback(
                save_freq=max(1, every // args.envs),
                save_path=str(ckpt_dir),
                name_prefix="ppo",
                save_vecnormalize=True,
            ),
            ProgressRaces(every, run_dir, video_dir),
            AdvantageStats(),
        ]
    )
    model.learn(
        total_timesteps=int(args.timesteps),
        callback=callbacks,
        tb_log_name="ppo",
        reset_num_timesteps=args.resume is None,
    )
    model.save(run_dir / "final")
    env.save(str(run_dir / "final_vecnormalize.pkl"))
    print("done:", run_dir / "final.zip")


if __name__ == "__main__":
    main()
