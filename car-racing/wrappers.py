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
from gymnasium.envs.box2d.car_racing import TRACK_WIDTH
from gymnasium.wrappers import GrayscaleObservation, ResizeObservation

LOOK_AHEAD = 10  # track points (~35 units) checked for a coming curve
FULL_CURVE = np.radians(45)  # this much turn ahead = the band is the whole road
TOP_SPEED = 100.0  # speed bonus is full at this speed (the car reaches ~85 on a straight)


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

    All values are per game frame. For scale: good driving earns ~1.4 a frame.

    - grass_penalty: lost while no wheel touches a road tile.
    - band_penalty: lost (at most) for leaving the centre band. On a straight the
      band is half the road; it widens to the whole road when a curve is coming
      (curves are fine to take wide). Grows from 0 at the band's edge to the full
      penalty at the road's edge.
    - speed_bonus: earned (at most) for speed along the track, on the road only,
      so spinning or cutting across the grass earns nothing.
    - steer_penalty: lost per unit of steering change from one decision to the next
      (steering goes from -1 to +1, so a full left-to-right flip costs 2x this).
      Against wobbling. The AI repeats each decision for 2 frames, so the change is
      charged once, on the first of the two frames.

    Keep the game's reward in info["game_reward"] so runs stay comparable, and
    info["wrong_way"] (car pointing against the track) so we can count it.
    """

    def __init__(self, env: gym.Env, grass_penalty: float = 0.0, band_penalty: float = 0.0, speed_bonus: float = 0.0, steer_penalty: float = 0.0):
        super().__init__(env)
        self.grass_penalty, self.band_penalty, self.speed_bonus = grass_penalty, band_penalty, speed_bonus
        self.steer_penalty = steer_penalty

    def reset(self, **kwargs):
        out = self.env.reset(**kwargs)
        self.geo = TrackGeometry(self.env.unwrapped.track)
        self.last_steer = 0.0
        return out

    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(action)
        info["game_reward"] = reward
        car = self.env.unwrapped.car
        grass = on_grass(self.env)
        side, along, facing, band = self.geo.where(car)
        info["wrong_way"] = facing < 0
        if self.grass_penalty and grass:
            reward -= self.grass_penalty
        if self.band_penalty:
            reward -= self.band_penalty * band_excess(side, band)
        if self.speed_bonus and not grass:
            reward += self.speed_bonus * min(max(along / TOP_SPEED, 0.0), 1.0)
        steer = float(np.clip(action[0], -1.0, 1.0))
        if self.steer_penalty:
            reward -= self.steer_penalty * abs(steer - self.last_steer)
        self.last_steer = steer
        return obs, reward, terminated, truncated, info


class TrackGeometry:
    """Where the car is on the track: distance from the centre line, speed along
    the track, which way it points, and how wide the centre band is there."""

    def __init__(self, track):
        xy = np.array([(x, y) for _, _, x, y in track])
        seg = np.roll(xy, -1, axis=0) - xy  # segment i goes from point i to point i+1
        self.start, self.seg = xy, seg
        self.length2 = (seg ** 2).sum(axis=1)
        self.dir = seg / np.sqrt(self.length2)[:, None]
        angle = np.arctan2(seg[:, 1], seg[:, 0])
        turn = np.abs((np.roll(angle, -1) - angle + np.pi) % (2 * np.pi) - np.pi)
        ahead = np.array([turn[np.arange(i, i + LOOK_AHEAD) % len(turn)].sum() for i in range(len(turn))])
        curve = np.minimum(ahead / FULL_CURVE, 1.0)
        self.band = TRACK_WIDTH * (0.5 + 0.5 * curve)  # half-width of the band: half the road -> the whole road

    def where(self, car) -> tuple[float, float, float, float]:
        p = np.array(car.hull.position)
        t = np.clip(((p - self.start) * self.seg).sum(axis=1) / self.length2, 0.0, 1.0)
        nearest = self.start + t[:, None] * self.seg
        i = int(np.argmin(((p - nearest) ** 2).sum(axis=1)))
        side = float(np.linalg.norm(p - nearest[i]))  # distance from the centre line
        along = float(np.dot(np.array(car.hull.linearVelocity), self.dir[i]))  # speed along the track
        heading = np.array(car.hull.GetWorldVector((0, 1)))  # where the car's nose points
        return side, along, float(np.dot(heading, self.dir[i])), float(self.band[i])


def band_excess(side: float, band: float) -> float:
    """0 inside the band, rising to 1 at the road's edge (and beyond)."""
    if side <= band:
        return 0.0
    room = TRACK_WIDTH - band
    return 1.0 if room <= 1e-6 else min((side - band) / room, 1.0)


def on_grass(env: gym.Env) -> bool:
    """True when none of the car's four wheels is touching a road tile.

    (Reading the screen for green pixels was unreliable: the red car covers the
    spot right under it.)
    """
    car = env.unwrapped.car
    return car is not None and all(len(wheel.tiles) == 0 for wheel in car.wheels)


def make_env(render_mode: str | None = None, grass_penalty: float = 0.0, band_penalty: float = 0.0, speed_bonus: float = 0.0, steer_penalty: float = 0.0, measure: bool = False) -> gym.Env:
    """One CarRacing game, wrapped the way the AI sees it.

    measure=True adds the ShapedReward wrapper with no shaping, just to record
    info["wrong_way"] (used by test races, which always score the game's way).
    """
    env = gym.make("CarRacing-v3", render_mode=render_mode)
    if grass_penalty or band_penalty or speed_bonus or steer_penalty or measure:
        # reads the car state each game frame
        env = ShapedReward(env, grass_penalty=grass_penalty, band_penalty=band_penalty, speed_bonus=speed_bonus, steer_penalty=steer_penalty)
    env = FrameSkip(env, skip=2)
    env = ResizeObservation(env, (64, 64))
    env = GrayscaleObservation(env, keep_dim=True)
    return env
