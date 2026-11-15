"""What the car sees, and how it is scored.

Two kinds of wrappers sit between Gymnasium's CarRacing game and the AI:

- Observation wrappers shrink the screen so it learns faster:
  repeat each action for 2 frames, resize 96x96 -> 64x64, and drop colour.
  (Frame stacking, "the last 2 frames", happens later on the vectorized envs.)
- An optional reward wrapper, `ShapedReward`, changes the scoring rules.
  The baseline uses the game's own reward; shaping is for later experiments.

Settings follow RL Zoo's tuned PPO config for CarRacing.
"""

import gymnasium as gym
import numpy as np
from gymnasium.wrappers import GrayscaleObservation, ResizeObservation


class FrameSkip(gym.Wrapper):
    """Repeat each action for `skip` frames and add up the rewards.

    The AI decides half as often, which makes learning faster: one decision
    every 2 frames is still plenty for steering.
    """

    def __init__(self, env: gym.Env, skip: int = 2):
        super().__init__(env)
        self.skip = skip

    def step(self, action):
        total = 0.0
        for _ in range(self.skip):
            obs, reward, terminated, truncated, info = self.env.step(action)
            total += float(reward)
            if terminated or truncated:
                break
        return obs, total, terminated, truncated, info


class ShapedReward(gym.Wrapper):
    """Our own scoring rules on top of the game's (off in the baseline).

    - grass_penalty: points lost per step while the car is on the grass.
      "On grass" is read from the screen: the pixels under the car are green.

    Keep the game's reward in info["game_reward"] so runs stay comparable.
    """

    def __init__(self, env: gym.Env, grass_penalty: float = 0.0):
        super().__init__(env)
        self.grass_penalty = grass_penalty

    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(action)
        info["game_reward"] = reward
        if self.grass_penalty and _on_grass(obs):
            reward -= self.grass_penalty
        return obs, reward, terminated, truncated, info


def _on_grass(frame: np.ndarray) -> bool:
    # The car is drawn at a fixed spot near the bottom middle of the 96x96 frame.
    patch = frame[66:78, 44:52].astype(np.int16)
    r, g, b = patch[..., 0].mean(), patch[..., 1].mean(), patch[..., 2].mean()
    return g > 150 and g > r + 40 and g > b + 40


def make_env(render_mode: str | None = None, grass_penalty: float = 0.0) -> gym.Env:
    """One CarRacing game, wrapped the way the AI sees it."""
    env = gym.make("CarRacing-v3", render_mode=render_mode)
    if grass_penalty:
        env = ShapedReward(env, grass_penalty=grass_penalty)  # needs the colour frame
    env = FrameSkip(env, skip=2)
    env = ResizeObservation(env, (64, 64))
    env = GrayscaleObservation(env, keep_dim=True)
    return env
