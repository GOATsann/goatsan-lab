"""Tests for what the car sees and how it is scored (wrappers.py), on the real CarRacing game.

    cd car-racing && .venv/bin/python -m pytest tests -q
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from wrappers import TRACK_WIDTH, FrameSkip, ShapedReward, TrackGeometry, band_excess, make_env, on_grass  # noqa: E402

GAS = np.array([0.0, 1.0, 0.0], dtype=np.float32)
IDLE = np.array([0.0, 0.0, 0.0], dtype=np.float32)


def test_band_excess_edges():
    band = TRACK_WIDTH / 2
    assert band_excess(0.0, band) == 0.0  # on the centre line
    assert band_excess(band, band) == 0.0  # exactly at the band's edge
    assert band_excess((band + TRACK_WIDTH) / 2, band) == pytest.approx(0.5)  # halfway to the road's edge
    assert band_excess(TRACK_WIDTH, band) == 1.0  # at the road's edge
    assert band_excess(TRACK_WIDTH * 3, band) == 1.0  # far on the grass: capped
    assert band_excess(TRACK_WIDTH + 1, TRACK_WIDTH) == 1.0  # band = whole road: any step off it is full


def test_observation_is_64x64_grayscale():
    env = make_env()
    obs, _ = env.reset(seed=1)
    assert obs.shape == (64, 64, 1) and obs.dtype == np.uint8
    obs, *_ = env.step(GAS)
    assert obs.shape == (64, 64, 1)
    env.close()


def test_frame_skip_adds_both_frames_rewards():
    """FrameSkip(2) = two game frames per decision, rewards summed: matches stepping the raw game twice."""
    import gymnasium as gym

    raw = gym.make("CarRacing-v3")
    raw.reset(seed=3)
    want = sum(float(raw.step(GAS)[1]) for _ in range(2 * 20))
    skip = FrameSkip(gym.make("CarRacing-v3"), skip=2)
    skip.reset(seed=3)
    got = sum(float(skip.step(GAS)[1]) for _ in range(20))
    assert got == pytest.approx(want, abs=1e-6)
    raw.close(); skip.close()


def test_game_reward_is_kept_and_shaping_off_changes_nothing():
    """measure=True adds ShapedReward with no shaping: the reward must equal the game's own."""
    env = make_env(measure=True)
    env.reset(seed=5)
    for _ in range(30):
        _, reward, _, _, info = env.step(GAS)
    # FrameSkip sums the frames; the last frame's game reward is in info, and the step total equals the game's
    assert "game_reward" in info and "wrong_way" in info
    env.close()
    a, b = make_env(), make_env(measure=True)
    a.reset(seed=7); b.reset(seed=7)
    ra = sum(a.step(GAS)[1] for _ in range(25))
    rb = sum(b.step(GAS)[1] for _ in range(25))
    assert ra == pytest.approx(rb, abs=1e-6)
    a.close(); b.close()


def test_grass_penalty_only_on_grass():
    import gymnasium as gym

    env = ShapedReward(gym.make("CarRacing-v3"), grass_penalty=0.5)
    env.reset(seed=11)
    _, reward, _, _, info = env.step(IDLE)
    assert not on_grass(env)  # the car starts on the road
    assert reward == pytest.approx(info["game_reward"])  # so no penalty
    env.close()


def test_steer_penalty_charges_the_change():
    import gymnasium as gym

    env = ShapedReward(gym.make("CarRacing-v3"), steer_penalty=0.1)
    env.reset(seed=13)
    _, r0, _, _, i0 = env.step(np.array([1.0, 0.0, 0.0], dtype=np.float32))  # 0 -> +1: change 1
    assert r0 == pytest.approx(i0["game_reward"] - 0.1)
    _, r1, _, _, i1 = env.step(np.array([-1.0, 0.0, 0.0], dtype=np.float32))  # +1 -> -1: change 2
    assert r1 == pytest.approx(i1["game_reward"] - 0.2)
    _, r2, _, _, i2 = env.step(np.array([-1.0, 0.0, 0.0], dtype=np.float32))  # no change
    assert r2 == pytest.approx(i2["game_reward"])
    env.close()


def test_track_geometry_on_the_start_line():
    import gymnasium as gym

    env = gym.make("CarRacing-v3")
    env.reset(seed=17)
    geo = TrackGeometry(env.unwrapped.track)
    side, along, facing, band = geo.where(env.unwrapped.car)
    assert side < TRACK_WIDTH  # the car starts on the road
    assert facing > 0.9  # pointing along the track
    assert TRACK_WIDTH * 0.5 - 1e-6 <= band <= TRACK_WIDTH + 1e-6  # half the road up to the whole road
    assert abs(along) < 1e-6  # standing still
    env.close()
