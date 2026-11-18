"""The Shooter Z network parts that saved models refer to (kept out of train.py so a saved model stores a
reference to this module, not a copy of the class)."""

from pathlib import Path

import torch
from gymnasium import spaces
from sb3_contrib import RecurrentPPO
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor
from torch import nn


class Encoder(BaseFeaturesExtractor):
    """2874 observation numbers (256 labelled rays x 11, enemy memory slots, own state) -> 256 features.
    The LSTM comes right after this (in sb3-contrib's RecurrentActorCriticPolicy)."""

    def __init__(self, observation_space: spaces.Box, features_dim: int = 256):
        super().__init__(observation_space, features_dim)
        self.net = nn.Sequential(nn.Linear(observation_space.shape[0], 256), nn.ReLU(), nn.Linear(256, features_dim), nn.ReLU())

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        return self.net(obs)


POLICY_KWARGS = dict(features_extractor_class=Encoder, features_extractor_kwargs=dict(features_dim=256),
                     lstm_hidden_size=256, n_lstm_layers=1, enable_critic_lstm=True, net_arch=dict(pi=[128], vf=[128]))


def load_model(path: Path, env=None, snapshot: Path | None = None) -> RecurrentPPO:
    """Load a saved model with this module's network classes (models from the first cloud runs stored a copy of
    the class that does not load elsewhere). `snapshot`: replace the weights with a policy_<steps>.pt."""
    m = RecurrentPPO.load(path, env=env, device="cpu", custom_objects={"policy_kwargs": POLICY_KWARGS})
    if snapshot is not None:
        m.policy.load_state_dict(torch.load(snapshot, map_location="cpu"))
    return m
