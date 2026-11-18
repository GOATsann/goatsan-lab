"""An LSTM cell written by hand, to see exactly what torch.nn.LSTM computes (LSTM_GUIDE.md).

    ../car-racing/.venv/bin/python train/lstm_cell.py     # runs the check against torch.nn.LSTM

One step takes the input x (256 features from the encoder) and the memory from the step before
(h = what it said last time, c = the long-term cell), and returns the new h and c:

    z = W_ih @ x + b_ih + W_hh @ h + b_hh        4 x 256 numbers, cut into 4 gates
    i = sigmoid(z[0])     input gate:  how much new information to write   (0..1 per memory slot)
    f = sigmoid(z[1])     forget gate: how much old memory to keep          (0..1)
    g = tanh(z[2])        candidate:   the new information itself            (-1..1)
    o = sigmoid(z[3])     output gate: how much of the memory to show        (0..1)
    c' = f * c + i * g                            keep some old, add some new
    h' = o * tanh(c')                             what the rest of the network sees

Gate order i, f, g, o is PyTorch's (weight_ih_l0 rows 0-255 = i, 256-511 = f, ...).
The weights are learned; h and c are only 256 numbers each, and are rebuilt every step.
"""

import torch


def lstm_step(x, h, c, W_ih, W_hh, b_ih, b_hh):
    """One time step. x: (batch, in), h and c: (batch, hidden). Returns (h', c')."""
    z = x @ W_ih.T + b_ih + h @ W_hh.T + b_hh
    zi, zf, zg, zo = z.chunk(4, dim=1)
    i, f, g, o = torch.sigmoid(zi), torch.sigmoid(zf), torch.tanh(zg), torch.sigmoid(zo)
    c = f * c + i * g
    h = o * torch.tanh(c)
    return h, c


def lstm_sequence(xs, h, c, W_ih, W_hh, b_ih, b_hh, episode_starts=None):
    """A whole sequence, like nn.LSTM, plus sb3-contrib's reset: where episode_starts[t] is 1, the
    memory is set to zero before step t (a new match starts with an empty memory)."""
    out = []
    for t, x in enumerate(xs):
        if episode_starts is not None:
            keep = (1.0 - episode_starts[t]).unsqueeze(1)
            h, c = keep * h, keep * c
        h, c = lstm_step(x, h, c, W_ih, W_hh, b_ih, b_hh)
        out.append(h)
    return torch.stack(out), (h, c)


def check() -> None:
    torch.manual_seed(0)
    T, B, IN, H = 12, 5, 256, 256  # 12 steps, 5 matches, sizes as in train.py
    ref = torch.nn.LSTM(IN, H)
    W = (ref.weight_ih_l0, ref.weight_hh_l0, ref.bias_ih_l0, ref.bias_hh_l0)
    xs = torch.randn(T, B, IN)
    h0, c0 = torch.randn(B, H), torch.randn(B, H)
    with torch.no_grad():
        want, (wh, wc) = ref(xs, (h0[None], c0[None]))
        got, (gh, gc) = lstm_sequence(xs, h0, c0, *W)
    err = max((want - got).abs().max(), (wh[0] - gh).abs().max(), (wc[0] - gc).abs().max()).item()
    print(f"hand-written vs torch.nn.LSTM: largest difference {err:.2e}")
    assert err < 1e-5

    # the reset: running steps 0-5, then a new match from step 6, equals two separate runs
    starts = torch.zeros(T, B)
    starts[6] = 1.0
    with torch.no_grad():
        joined, _ = lstm_sequence(xs, h0, c0, *W, episode_starts=starts)
        zeros = torch.zeros(B, H)
        second, _ = ref(xs[6:], (zeros[None], zeros[None]))
    err2 = (joined[6:] - second).abs().max().item()
    print(f"reset at a new match = a fresh LSTM: largest difference {err2:.2e}")
    assert err2 < 1e-5
    n = sum(p.numel() for p in ref.parameters())
    print(f"weights in one 256 -> 256 LSTM: {n:,} (4 gates x 256 x (256 + 256) + 2 x 4 x 256 biases)")


if __name__ == "__main__":
    check()
