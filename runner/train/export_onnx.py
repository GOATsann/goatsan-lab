"""Export a trained runner policy to ONNX for the browser AI (split screen), with a parity check.

    cd runner && ../car-racing/.venv/bin/python train/export_onnx.py r3-v4
    ... --checkpoint runs/r3-v4/checkpoints/ppo_4000128_steps.zip      # an earlier, easier AI
    ... --game-dir <a frozen runner copy>   # play on the exact game version the model was trained on

Writes into runs/<run>/:
- policy.onnx (or policy_<steps>.onnx): input "obs" float32 [batch, obs_size], output "logits"
  float32 [batch, n_actions]. Only the actor's forward pass; argmax = the benchmark's deterministic play.
  No observation normalization is baked in, because training does not normalize observations.
- policy.json (or policy_<steps>.json): version, obs_size, n_actions, observe_chaser, run, steps, benchmark mean.
- policy_parity.json (or policy_<steps>_parity.json): observations from real play and the actions PyTorch picks.
  The export fails unless ONNX Runtime picks exactly the same actions.
"""

import argparse
import csv
import json
import pickle
import re
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from stable_baselines3 import PPO
from torch import nn

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from runner_env import RunnerVecEnv  # noqa: E402
from train import MAX_TICKS, PROGRESS_OPTIONS, GameServers  # noqa: E402


class Actor(nn.Module):
    """obs -> action logits, the same computation as SB3's ActorCriticPolicy for a Discrete action space."""

    def __init__(self, policy):
        super().__init__()
        self.features, self.mlp, self.head = policy.pi_features_extractor, policy.mlp_extractor, policy.action_net

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        return self.head(self.mlp.forward_actor(self.features(obs)))


def collect(model: PPO, env: RunnerVecEnv, n: int, seeds: list[int]) -> np.ndarray:
    """n observations from deterministic play, spread over several seeds and over each run."""
    seen = []
    for seed in seeds:
        obs = env.set_seed(0, seed)[None]
        while True:
            seen.append(obs[0].copy())
            action, _ = model.predict(obs, deterministic=True)
            obs, _, done, _ = env.step(action)
            if done[0]:
                break
    pick = np.linspace(0, len(seen) - 1, n).astype(int)
    return np.stack([seen[i] for i in pick]).astype(np.float32)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("run")
    p.add_argument("--checkpoint", type=Path, help="a checkpoint .zip instead of final.zip")
    p.add_argument("--game-dir", type=Path, default=ROOT, help="runner folder whose game server to play (must match the model's version)")
    p.add_argument("--parity", type=int, default=50)
    p.add_argument("--port", type=int, default=7980)
    args = p.parse_args()

    run_dir = ROOT / "runs" / args.run
    meta = json.loads((run_dir / "meta.json").read_text())
    zip_path = args.checkpoint or run_dir / "final.zip"
    model = PPO.load(zip_path, device="cpu")
    steps = int(re.search(r"_(\d+)_steps", zip_path.name).group(1)) if args.checkpoint else int(model.num_timesteps)
    stem = f"policy_{steps}" if args.checkpoint else "policy"

    norm = run_dir / "final_vecnormalize.pkl"
    if norm.exists():  # training normalizes rewards only; if that ever changes, the normalization must go into the graph
        with norm.open("rb") as f:
            assert not pickle.load(f).norm_obs, "VecNormalize normalizes observations: bake obs_rms into the graph first"

    actor = Actor(model.policy).eval()
    obs_size = model.observation_space.shape[0]
    onnx_path = run_dir / f"{stem}.onnx"
    torch.onnx.export(actor, torch.zeros(1, obs_size), str(onnx_path), input_names=["obs"], output_names=["logits"],
                      dynamic_axes={"obs": {0: "batch"}, "logits": {0: "batch"}}, opset_version=17, dynamo=False)

    servers = GameServers(1, args.port, run_dir / "logs", game_dir=args.game_dir)
    try:
        options = meta.get("game_options", PROGRESS_OPTIONS)  # the rules the model was trained on
        if "level" in options:
            options = options | {"level": "normal"}  # parity on a fixed level
        env = RunnerVecEnv(servers.ports[0], n_envs=1, seed_base=10**9, max_ticks=MAX_TICKS, options=options)  # one client per server
        if env.version != meta["game_version"]:
            raise SystemExit(f"model trained on game version {meta['game_version']}, server in {args.game_dir} is {env.version}")
        obs = collect(model, env, args.parity, seeds=[1000, 1001, 1002])
        env.close()
    finally:
        servers.stop()

    with torch.no_grad():
        torch_actions = actor(torch.from_numpy(obs)).argmax(dim=1).numpy()
    sess = ort.InferenceSession(str(onnx_path))
    onnx_actions = sess.run(["logits"], {"obs": obs})[0].argmax(axis=1)
    mismatch = int((torch_actions != onnx_actions).sum())
    if mismatch:
        raise SystemExit(f"ONNX picks a different action on {mismatch} of {len(obs)} observations")
    sb3_actions, _ = model.predict(obs, deterministic=True)
    assert (sb3_actions == torch_actions).all(), "the exported actor does not match SB3's predict()"

    bench_mean = None
    bench = run_dir / "bench.csv"
    if bench.exists() and not args.checkpoint:
        bench_mean = round(float(np.mean([float(r["score"]) for r in csv.DictReader(bench.open())])), 1)
    (run_dir / f"{stem}.json").write_text(json.dumps({
        "version": meta["game_version"], "obs_size": obs_size, "n_actions": int(model.action_space.n),
        "observe_chaser": bool(meta.get("game_options", {}).get("observe_chaser", False)), "run": args.run, "steps": steps,
        "benchmark_mean": bench_mean, "input": "obs", "output": "logits", "play": "argmax",
    }, indent=2))
    (run_dir / f"{stem}_parity.json").write_text(json.dumps({
        "obs": [[float(v) for v in o] for o in obs], "actions": [int(a) for a in torch_actions],
    }))
    print(f"{onnx_path} ({onnx_path.stat().st_size / 1024:.0f} KB): {len(obs)} parity observations, all actions match "
          f"(actions used: {np.bincount(torch_actions, minlength=5).tolist()})")


if __name__ == "__main__":
    main()
