"""Export a Shooter Z policy to ONNX for the browser (one decision per call, LSTM memory passed in and out),
with a parity check on real matches.

    ../car-racing/.venv/bin/python train/export_onnx.py runs/A-curriculum@28006400

Writes runs/<run>/policy[_<steps>].onnx and .json (how to use it).
ONNX inputs: obs float32 [batch, 2874], h float32 [1, batch, 256], c float32 [1, batch, 256].
Outputs: logits float32 [batch, 40] (the 9 action parts back to back, sizes in .json "action_nvec"), h_out, c_out.
Play: per part, argmax of its slice; map it with .json "decode" to the protocol's action vector
(PROTOCOL.md). Memory: start each robot with h = c = 0 at match start (not on respawn: training kept the
memory across a respawn), then feed back h_out / c_out every decision (20 per second, every 3 game ticks).
The export fails unless ONNX Runtime picks exactly the same actions as PyTorch over whole matches.
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from torch import nn

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from szenv import ACTION_NVEC, PITCH_BINS, YAW_BINS, ShooterVecEnv  # noqa: E402
from szpolicy import load_model  # noqa: E402


class Actor(nn.Module):
    """One decision of sb3-contrib's RecurrentActorCriticPolicy actor: encoder -> LSTM step -> head."""

    def __init__(self, policy):
        super().__init__()
        self.features, self.lstm = policy.pi_features_extractor, policy.lstm_actor
        self.mlp, self.head = policy.mlp_extractor, policy.action_net

    def forward(self, obs, h, c):
        x = self.features(obs).unsqueeze(0)  # (time 1, batch, 256)
        y, (h2, c2) = self.lstm(x, (h, c))
        return self.head(self.mlp.forward_actor(y[0])), h2, c2


def argmax_parts(logits: np.ndarray) -> np.ndarray:
    out, k = [], 0
    for n in ACTION_NVEC:
        out.append(logits[:, k:k + n].argmax(1))
        k += n
    return np.stack(out, 1)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("model", help="<run> (final.zip) or <run>@<steps> (a snapshot)")
    p.add_argument("--matches", type=int, default=4)
    p.add_argument("--port", type=int, default=7900)
    args = p.parse_args()
    run, _, steps = args.model.partition("@")
    run = Path(run)
    snap = run / "snapshots" / f"policy_{int(steps):010d}.pt" if steps else None
    model = load_model(run / "final.zip", snapshot=snap)
    stem = f"policy_{int(steps)}" if steps else "policy"
    actor = Actor(model.policy).eval()
    H = model.policy.lstm_actor.hidden_size
    onnx_path = run / f"{stem}.onnx"
    obs0, h0 = torch.zeros(1, 2874), torch.zeros(1, 1, H)
    torch.onnx.export(actor, (obs0, h0, h0.clone()), onnx_path, input_names=["obs", "h", "c"], output_names=["logits", "h_out", "c_out"],
                      dynamic_axes={"obs": {0: "batch"}, "h": {1: "batch"}, "c": {1: "batch"}, "logits": {0: "batch"},
                                    "h_out": {1: "batch"}, "c_out": {1: "batch"}}, opset_version=17, dynamo=False)
    sess = ort.InferenceSession(str(onnx_path))

    # parity: whole matches vs Normal bots, PyTorch drives; ONNX runs alongside with its own memory
    srv = subprocess.Popen([str(ROOT / "node_modules" / ".bin" / "tsx"), "src/headless/server.ts", "--port", str(args.port)],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    try:
        n = args.matches
        env = ShooterVecEnv(args.port, n, opponent="bot", options={"opponent_skill": "normal"}, seed_base=6000, max_ticks=60 * 60 * 2)
        obs = np.stack([env.set_seed(i, 6000 + i)[0] for i in range(n)])
        state, start = None, np.ones(n, dtype=bool)
        h = np.zeros((1, n, H), np.float32); c = h.copy()
        decisions = mismatches = 0
        finished = np.zeros(n, dtype=bool)
        while not finished.all():
            a_torch, state = model.policy.predict(obs, state=state, episode_start=start, deterministic=True)
            keep = (~start).astype(np.float32)[None, :, None]
            logits, h, c = sess.run(None, {"obs": obs.astype(np.float32), "h": h * keep, "c": c * keep})
            a_onnx = argmax_parts(logits)
            live = ~finished
            mismatches += int((a_onnx[live] != a_torch[live]).any(1).sum())
            decisions += int(live.sum())
            obs, _, done, _ = env.step(a_torch)
            finished |= done
            start = done
        env.close()
    finally:
        srv.terminate()
    print(f"parity: {decisions:,} decisions over {n} whole matches, {mismatches} with a different action")
    if mismatches:
        raise SystemExit("ONNX and PyTorch disagree: not exporting")
    meta = {
        "model": args.model, "steps": int(steps) if steps else model.num_timesteps, "obs_size": 2874, "lstm_hidden": H,
        "action_fields": ["forward", "strafe", "jump", "crouch", "yaw", "pitch", "fire", "reload", "ability"],
        "action_nvec": list(ACTION_NVEC),
        "decode": {"forward": [-1, 0, 1], "strafe": [-1, 0, 1], "jump": [0, 1], "crouch": [0, 1],
                   "yaw": YAW_BINS.tolist(), "pitch": PITCH_BINS.tolist(), "fire": [0, 1], "reload": [0, 1], "ability": [0, 1]},
        "decode_note": "value per choice index = the protocol action vector entry (PROTOCOL.md); yaw/pitch are a share of the turn cap per tick",
        "memory": "h = c = 0 at match start, then feed h_out/c_out back every decision (also across respawns)",
        "decision_ticks": 3, "turn_cap_rad_per_tick": 10 / 60, "parity_decisions": decisions,
    }
    (run / f"{stem}.json").write_text(json.dumps(meta, indent=2))
    print(f"wrote {onnx_path} ({onnx_path.stat().st_size / 1e6:.1f} MB) and {stem}.json")


if __name__ == "__main__":
    main()
