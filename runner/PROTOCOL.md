# Batch server protocol (Node game server <-> Python trainer)

Status: proposal by the Python side (personal-website [a39e8d]); the server side (personal-website
[43d7c1]) confirms or edits. Both sides follow this file; change it here first.

## Transport

- TCP on 127.0.0.1, port given to the server on the command line (`npm run server -- --port 7001`).
  One Python client per server process. Several server processes per machine (one per core).
- All numbers little-endian. Every message is `u32 length` + body (length = body bytes).
- The first message each way is UTF-8 JSON (handshake). After that, every message is binary with a
  `u8 command` first.

## Handshake

Python -> server:

```json
{ "n_envs": 64, "seed_base": 1000000, "max_ticks": 36000 }
```

- `seed_base`: env `i`'s k-th episode uses seed `seed_base + k * n_envs + i` (deterministic, no
  overlap between envs). Benchmark seeds (1000-1099) stay out of the training range.
- `max_ticks`: truncate an episode after this many ticks (36000 = 10 minutes of game time).

Server -> Python:

```json
{
  "version": 1,
  "obs_size": 782,
  "n_actions": 5,
  "decision_ticks": 4,
  "event_fields": ["distance", "coins", "powerups", "jumps", "rolls", "laneChanges", "stumbles", "died",
                   "score", "meters", "ticks"],
  "death_causes": ["", "low", "high", "trainFront", "trainSide", "movingTrain", "stumble"]
}
```

`version` is `Game.VERSION`; Python stores it with every run, and refuses replays of another version.

## Commands

### 1 = reset all

Python: `u8 1`. Server: resets every env to its next seed. Reply: `f32 obs[n_envs * obs_size]`.

### 2 = step

Python: `u8 2`, `u8 actions[n_envs]` (0 nothing, 1 left, 2 right, 3 jump, 4 roll).
Each env runs `Game.decide(action)` (one decision = `decision_ticks` ticks).

Reply, in this order:

| Field | Type | Meaning |
|---|---|---|
| obs | `f32[n_envs * obs_size]` | next observation; for a finished env, the first obs of its next episode (auto-reset) |
| events | `f32[n_envs * n_event_fields]` | this decision's events, fields in handshake order; `score`, `meters`, `ticks` are episode totals so far |
| terminated | `u8[n_envs]` | 1 = died this decision |
| truncated | `u8[n_envs]` | 1 = hit `max_ticks` |
| death_cause | `u8[n_envs]` | index into `death_causes` (0 when alive) |
| seed | `u32[n_envs]` | seed of the episode the events belong to |
| n_done | `u16` | number of finished envs this step |
| done list | `n_done x (u16 env, f32 terminal_obs[obs_size])` | the last obs before the auto-reset (SB3 needs it for bootstrapping truncated episodes) |

### 3 = replay

Python: `u8 3`, `u16 env`. Reply: UTF-8 JSON of the `Replay` (version, seed, endTick, actions) of that
env's most recently finished episode. Used for progress races and benchmark seeds that get rendered.

### 4 = run fixed seeds (benchmark / progress race)

Python: `u8 4`, `u16 env`, `u32 seed`. Resets that env to exactly this seed (outside the seed stream).
The next steps continue normally; after it finishes, the env goes back to its seed stream.

### 0 = close

Python: `u8 0`. Server closes the connection and exits.

## Reward

The server sends events only. Python turns them into the reward with `train/reward.json` (one weight
per event, documented there), so the user can tune the reward without touching the game. The benchmark
always scores with the game's own `score`.
