# How the Shooter Z AI uses an LSTM

The trainer uses the `RecurrentPPO` of [sb3-contrib](https://github.com/Stable-Baselines-Team/stable-baselines3-contrib)
2.9.2 (PPO with an LSTM). This guide shows where the LSTM lives in that library, what it computes, and how
PPO trains it on sequences. `lstm_cell.py` is a hand-written LSTM that matches `torch.nn.LSTM`.

## 1. The network, one decision (20 per second)

```
 game server (TypeScript)                          Python (train.py / sb3-contrib)
 ------------------------                          ------------------------------------------------------
 observation, 2874 floats                           Encoder (train.py)
   256 rays x 11 (distance, what it hit,            Linear 2874 -> 256, ReLU
     body part, team, ...)                ------>   Linear  256 -> 256, ReLU            = x_t (256)
   3 enemy memory slots x 10                                     |
   own state x 28 (health, ammo, ...)                 +----------+-----------+
                                                      |                      |
                                         actor LSTM 256 -> 256     critic LSTM 256 -> 256
                     memory of last step  (h, c)_t-1 ->|  (h, c)_t-1 ->|
                                                       v                      v
                                                     h_t (256)              h_t (256)
                                                       |                      |
                                          Linear 256 -> 128, tanh    Linear 256 -> 128, tanh
                                                       |                      |
                                          action logits (40)         Linear 128 -> 1
                                          = 9 heads, sampled:        = value V(s): the expected
     forward 3 | strafe 3 | jump 2 | crouch 2 |      future reward from here
     yaw 13 | pitch 11 | fire 2 | reload 2 | ability 2
                         |
          szenv.to_vector(): bins -> turn per tick, buttons -> 0/1
                         |
                         v
 game server steps 3 ticks (1/20 s), returns new obs + events -> reward (reward.json)
```

Sizes (measured): encoder 801,792 weights, each LSTM 526,336, heads 71,081. Total **1.93M** weights.
The actor and the critic share the encoder but each has its own LSTM (`enable_critic_lstm=True`).

## 2. Inside one LSTM step

```
            x_t (256)        h_t-1 (256)
               |                 |
               +--> z = W_ih x_t + b_ih + W_hh h_t-1 + b_hh     (1024 = 4 x 256)
                         |       |       |       |
                      sigmoid sigmoid  tanh   sigmoid
                         i       f       g       o
                    (write?) (keep?)  (new info) (show?)

     c_t-1 ---(x f)---(+)---> c_t ----tanh---(x o)---> h_t
                       ^
                (i x g)
```

- `c` (cell, 256 numbers) is the long memory. `f` near 1 keeps it, near 0 erases it.
- `h` (256 numbers) is what the LSTM outputs this step and feeds to itself next step.
- The weights (`W_ih` 1024x256, `W_hh` 1024x256, biases) are learned. `h` and `c` are not weights:
  they are rebuilt every step from the weights and the inputs.
- Run `../car-racing/.venv/bin/python train/lstm_cell.py`: the hand-written step matches `nn.LSTM`
  to 2e-7, and the reset (below) equals a fresh LSTM.

## 3. Where it is in the library

Paths are inside `car-racing/.venv/lib/python3.11/site-packages/sb3_contrib/`. Read in this order:

| # | File : lines | What happens |
|---|---|---|
| 1 | `common/recurrent/policies.py` : 112-147 | The two `nn.LSTM` are built (actor, and critic with `enable_critic_lstm`). |
| 2 | `common/recurrent/policies.py` : 212-257 `forward` | One decision: encoder -> `_process_sequence` -> heads -> action, value, log-prob, new states. |
| 3 | `common/recurrent/policies.py` : 162-210 `_process_sequence` | The core. Reshapes to (time, sequences, 256). If no match starts inside the sequence, one fast `lstm(...)` call. Otherwise a loop over time steps; lines 197-204 multiply `h` and `c` by `(1 - episode_start)`: **memory is zeroed when a new match starts**. |
| 4 | `ppo_recurrent/ppo_recurrent.py` : 228-299 `collect_rollouts` | Playing. Keeps `lstm_states` across steps (line 242), stores the state *before* each step in the buffer (line 294). Lines 270-284: on a training cut-off, adds γ·V(last obs) so a cut-off is not treated as a loss. |
| 5 | `common/recurrent/buffers.py` : 149-199 `get` | Learning. Flattens the rollout per match (keeps time order), rotates it at a random point, cuts it into minibatches of `batch_size`. |
| 6 | `common/recurrent/buffers.py` : 66-97 `create_sequencers` | A new sequence starts at each match start, at each change of match slot, and at each minibatch edge. Sequences are padded to the same length; `mask` hides the padding. |
| 7 | `common/recurrent/buffers.py` : 201-235 `_get_samples` | Each sequence starts from the `(h, c)` **stored during play** at its first step. So the LSTM does not need to replay the match from the start. |
| 8 | `ppo_recurrent/ppo_recurrent.py` : 330-365 `train` | `evaluate_actions` re-runs the LSTM over each sequence with the current weights, then the normal PPO loss (clipped ratio, value loss, entropy), with the padding masked out. |

## 4. How PPO feeds it sequences (our numbers)

```
 one rollout = 128 decisions (6.4 s) x 80 learner slots = 10,240 steps
 (5 servers: 4 x 16 learner slots + 1 x 16)

 slot 0:  [ match 7 ........ | match 8 (new: h,c = 0) ......... ]   128 steps
 slot 1:  [ match 3 ......................................... ]
 ...
            |__ sequence __|  |__ sequence ____________________|    cut at every match start

 flatten per slot -> rotate at a random point -> 2 minibatches of 5,120 -> 3 epochs
 each sequence: start (h,c) = the stored state, run the LSTM forward through it,
                backpropagate through it ("unrolled" in time) = truncated BPTT, at most 128 steps
```

- **During play** the memory runs across the whole match (minutes). Nothing cuts it except a new match.
- **During learning** the gradient only flows back inside one sequence (at most 128 decisions = 6.4 s).
  The LSTM can still *use* older memory (it is in the stored start state), but it learns to *create*
  useful memory only from what happens within about 6 s. That is truncated BPTT
  (backpropagation through time).
- The value function looks further ahead than that: γ = 0.995 per decision gives a horizon of about
  1 / (1 - 0.995) = 200 decisions = 10 s, and GAE (λ = 0.95) spreads the reward back over the steps.

## 5. Self-play and the LSTM

In a self-play match both robots are learner slots, each with its own `(h, c)`. They share weights, but
not memory. A frozen snapshot (`train.py` `Snapshot`) keeps its own `(h, c)` in `szenv.py`
(`frozen_state`), reset by `frozen_start` when its match ends.
