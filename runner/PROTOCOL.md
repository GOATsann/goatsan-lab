# Batch server protocol (Node game server <-> Python trainer)

Status: agreed. Proposed by the Python side (a39e8d), confirmed with two edits by the server side
(43d7c1): the real death-cause names, and a reply for command 4. Both sides follow this file; change it
here first. Server: `src/headless/server.ts`.

## Transport

- TCP on 127.0.0.1, port given to the server on the command line (`npm run server -- --port 7001`).
  One Python client per server process. Several server processes per machine (one per core).
- All numbers little-endian. Every message is `u32 length` + body (length = body bytes).
- The first message each way is UTF-8 JSON (handshake). After that, every message is binary with a
  `u8 command` first.

## Handshake

Python -> server:

```json
{ "n_envs": 64, "seed_base": 1000000, "max_ticks": 36000,
  "powerups": true, "stumbles_to_catch": 2, "observe_chaser": false, "level": "random" }
```

- `powerups`, `stumbles_to_catch`, `observe_chaser` are optional (defaults shown). `powerups: false`
  gives the same tracks without power-ups (for clean benchmarks). `observe_chaser: false` keeps the
  chaser's two state values at 0, so the AI cannot see it.
- `level`: start level `"easy"`, `"normal"`, `"hard"`, or `"random"` (default): each episode's level
  comes from its seed with the core's PRNG (`levelFromSeed`), so the same seed always gets the same
  level. The level is stored in every replay's `options.level` (0 easy, 1 normal, 2 hard).

- `seed_base`: env `i`'s k-th episode uses seed `seed_base + k * n_envs + i` (deterministic, no
  overlap between envs). Benchmark seeds (1000-1099) stay out of the training range.
- `max_ticks`: truncate an episode after this many ticks (36000 = 10 minutes of game time).

Server -> Python:

```json
{
  "version": 4,
  "obs_size": 1074,
  "n_actions": 5,
  "decision_ticks": 4,
  "event_fields": ["distance", "coins", "powerups", "jumps", "rolls", "laneChanges", "stumbles", "died",
                   "score", "meters", "ticks", "shieldsUsed", "level"],
  "death_causes": ["", "train front", "oncoming train", "caught"],
  "rules": { "powerups": true, "stumblesToCatch": 2 },
  "level": "random",
  "level_names": ["easy", "normal", "hard"],
  "observe_chaser": false,
  "obs_layout": {
    "lanes": 3, "rows": 32, "row_len_mm": 3000, "first_row_offset_mm": -3000,
    "channels": ["low", "high", "trainFront", "trainBody", "ramp", "coin", "moving",
                 "magnet", "spring", "double", "shield"],
    "grid_order": "lane,row,channel",
    "state": ["lane0", "lane1", "lane2", "x", "y", "vy", "grounded", "rolling", "onRoof", "speed",
              "slowed", "magnet", "spring", "double", "shield", "heat", "chaserNear", "stumbleCount"]
  }
}
```

`version` is `Game.VERSION`; Python stores it with every run, and refuses replays of another version.
Grid index = `(lane * rows + row) * channels + channel`; the state values follow the grid.

Rules v2 (stumbles and the chaser): running into a barrier or changing lanes into the side of
anything is a **stumble** (you break through or bounce back, slow to 60% for 1 s, and the chaser closes
in for 5 s). A stumble while the chaser is still close adds up; reaching `stumbles_to_catch` = **caught**
(game over). Running clean for 5 s resets it. Head-on into a train still ends the run. A **shield**
power-up absorbs one hit of any kind (event `shieldsUsed`). Replays store the rule options.

Rules v3: a roll is a fixed 0.6 s move. Roll pressed while rolling does nothing, and after a roll the
runner stands for at least 0.2 s before it can roll again (no endless roll, for humans or the AI).

Rules v4: difficulty ("heat") rises for the whole run with no ceiling: start level base (easy 0,
normal 0.3, hard 0.6) + a smooth ramp of +1 over the first 3 minutes + 0.25 every 2 minutes after
that. Speed = 10 m/s + 8.4 m/s per heat unit. Higher heat also shortens the empty run-up before each
track piece (up to 60%) and makes hard pieces more likely; two new hard pieces. The jump is longer:
about 0.75 s in the air with a short hang at the top (about 1.39 m high). New state value `heat`
(heat / 2); `speed` is now (speed - 10 m/s) / 16.8 m/s and keeps growing past 1. Event `level` is the
episode's start level (constant). All numbers are named constants in `src/core/config.ts`.

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
Reply: `f32 obs[obs_size]` (that env's first observation). The next steps continue normally; after it
finishes, the env goes back to its seed stream.

Death causes come from `DEATH_CAUSES` in `src/core/game.ts`: "train front" (ran into a standing train),
"oncoming train" (hit by a moving one), "caught" (by the chaser, after too many stumbles in a row).

### 0 = close

Python: `u8 0`. Server closes the connection and exits.

## Reward

The server sends events only. Python turns them into the reward with `train/reward.json` (one weight
per event, documented there), so the user can tune the reward without touching the game. The benchmark
always scores with the game's own `score`.
