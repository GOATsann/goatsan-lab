# Batch server protocol (Node game server <-> Python trainer)

Status: first version, same shape as [runner/PROTOCOL.md](../runner/PROTOCOL.md) so the runner's Python
client, reward breakdown, benchmark and dashboard carry over with small changes. The deviations are listed
at the end. Server: `src/headless/server.ts`; tests: `test/server.test.ts`.

## Transport

- TCP on 127.0.0.1, port on the command line (`npm run server -- --port 7001`). One Python client per
  server process; several processes per machine (one per core).
- All numbers little-endian. Every message is `u32 length` + body (length = body bytes).
- The first message each way is UTF-8 JSON (handshake). After that, every message is binary with a
  `u8 command` first.

## Handshake

Python -> server:

```json
{ "n_envs": 64, "seed_base": 1000000, "max_ticks": 10800,
  "mode": "duel", "map": "random", "opponent_skill": "random", "character": "random",
  "score_limit": 10, "turn_cap": 0.1667 }
```

- `mode`: `"duel"` (1v1), `"ffa"` (1 vs 3), `"team"` (2v2; the learner's teammate is a bot).
- `map`: `"base"`, `"ship"` or `"random"`. `opponent_skill`: `"easy"`, `"normal"`, `"hard"` or
  `"random"`. `character`: the learner's character index (0 Dash/dash, 1 Bulwark/shield, 2 Echo/scan,
  3 Wisp/cloak) or `"random"`. With "random", each episode's choice comes from its seed with the core's
  PRNG, so the same seed always gives the same map, opponents and characters. Bots always get random
  characters from the seed.
- `seed_base`: env `i`'s k-th episode uses seed `seed_base + k * n_envs + i`.
- `max_ticks`: training cut-off (truncation, not a loss). Players never have a round timer.
- `turn_cap`: the learner's maximum turn per tick in radians (default 10 rad/s = 0.1667 per tick).
- `opponent` (protocol 2): what robot 1 is. `"bot"` (default: a heuristic bot at `opponent_skill`),
  `"still"` (a training target that never moves or fires), `"moving"` (a heuristic bot that moves and aims
  but never fires, reloads or uses its ability: a moving target), or `"learner"` (duel only: robot 1 is a
  second learner driven by Python, for self-play).

Server -> Python (abridged):

```json
{
  "version": 1, "protocol": 1,
  "obs_size": 2874,
  "action_size": 9,
  "action_fields": ["forward", "strafe", "jump", "crouch", "yaw", "pitch", "fire", "reload", "ability"],
  "turn_cap": 0.1667, "decision_ticks": 3, "tick_hz": 60,
  "event_fields": ["damageDealt", "damageTaken", "hits", "headshots", "shots", "kills", "deaths",
                   "teamKills", "teamDeaths", "abilities", "shieldBlocks",
                   "won", "lost", "teamScore", "enemyScore", "ticks"],
  "end_causes": ["", "won", "lost"],
  "mode": "duel", "agents": 2, "learner_slot": 0,
  "characters": [{ "id": 0, "name": "Dash", "ability": "dash" }, "..."],
  "obs_layout": { "rays": { "...": "..." }, "memory": { "...": "..." }, "self": ["..."] }
}
```

`version` is the game's rules version (`VERSION` in `src/core/game.ts`); replays of another version are
refused.

### Observation (`obs_layout`, built in `src/core/obs.ts`)

1. **Rays**: 256 labelled rays from the eye. A wide grid (25 x 7, +-50 deg x +-32 deg, denser toward the
   middle) and a dense fovea patch (9 x 9 within +-3 deg of the crosshair). Per ray, 11 floats:
   distance / 60 m, one-hot label (`none, wall, cover, floor, enemyHead, enemyTorso, enemyLegs, teammate,
   enemyShield`), and "that robot is spawn-protected". Occlusion and partial cover come for free.
   Cloaked enemies are invisible to rays beyond 6 m.
2. **Memory slots**: one per other robot (3 slots, id order, skipping self), 10 floats each: known,
   position in the robot's own frame (right, forward) / 50 m, height difference, age, and the source
   one-hot (`outline` after you hit it, `ping` after it fired, `reveal` after 15 s idle, `teammate`,
   `scan`). This is exactly what the minimap and outlines show a player.
3. **Own state**: 28 floats (alive, health, ammo, reload, fire cooldown, spawn shield, velocity in own
   frame, grounded, crouch, pitch, damage-direction indicator, position, heading, scores, ability ready /
   cooldown / active, character one-hot).

### Action (one decision = `decision_ticks` ticks)

9 floats per env: `forward`, `strafe` in {-1, 0, 1} (rounded at +-0.5), `jump`, `crouch`, `fire`,
`reload`, `ability` on when > 0.5, `yaw` and `pitch` in [-1, 1] x `turn_cap` **per tick** (positive yaw
turns left, positive pitch looks up). `crouch` and `fire` are held for the whole decision; `jump`,
`reload` and `ability` act on its first tick only.

## Agents (protocol 2)

The reply's `learner_slots` lists the robots Python drives in every match: `[0]`, or `[0, 1]` with
`opponent: "learner"`. Every per-match array below is **per agent**, agent = env x learner, in that order
(agent `a` is env `a // L`, learner `a % L`, with `L = len(learner_slots)`): observations, actions, events,
terminated, truncated, end_cause, seed, and the done list (which then names agents; both learners of a
finished match are listed together). Command 4 returns the observations of all learners of that env.
With one learner, this is exactly protocol 1.

## Commands

### 1 = reset all

Python: `u8 1`. Each env starts its next seed. Reply: `f32 obs[n_envs * obs_size]`.

### 2 = step

Python: `u8 2`, `f32 actions[n_envs * action_size]`.

Reply, in this order:

| Field | Type | Meaning |
|---|---|---|
| obs | `f32[n_envs * obs_size]` | next observation; for a finished env, the first obs of its next episode (auto-reset) |
| events | `f32[n_envs * n_event_fields]` | this decision's counts for the learner (handshake order); `teamScore`, `enemyScore`, `ticks` are episode totals so far |
| terminated | `u8[n_envs]` | 1 = the match ended (someone reached the score limit) |
| truncated | `u8[n_envs]` | 1 = hit `max_ticks` |
| end_cause | `u8[n_envs]` | index into `end_causes`: 1 won, 2 lost, 0 otherwise |
| seed | `u32[n_envs]` | seed of the episode the events belong to |
| n_done | `u16` | number of finished envs this step |
| done list | `n_done x (u16 env, f32 terminal_obs[obs_size])` | the last obs before the auto-reset |

### 3 = replay

Python: `u8 3`, `u16 env`. Reply: UTF-8 JSON of that env's most recently finished episode's `Replay`
(`version, seed, options, endTick, inputs, hash`), or `null`. `npm run replay -- file.json` rebuilds it.

### 4 = run a fixed seed

Python: `u8 4`, `u16 env`, `u32 seed`. Resets that env to exactly this seed. Reply: `f32 obs[obs_size]`.

### 0 = close

Python: `u8 0`. The server closes the connection.

## Reward

The server sends events only; Python turns them into the reward (a `reward.json` with one weight per
event, like the runner). Planned: win/lose as the main signal; `damageDealt` (headshots already count
x2.5) and `damageTaken` as helpers that fade out; small costs for `shots` without `hits`. In 2v2 the
reward must be **shared by the team** (`teamKills`, `teamDeaths`, `won`/`lost` are team results).

## Deviations from runner/PROTOCOL.md

- **Actions are a float vector** (`f32[n_envs * 9]`, `action_size` / `action_fields`), not one `u8`
  discrete action: aiming is continuous. A discrete wrapper can be built on the Python side.
- **Episode end**: `end_cause` (won / lost) replaces `death_cause`; dying is not the end of an episode.
- **Episode setup comes from the seed**: map, opponent level and characters (no `level` option).
- **Learners per match**: one (slot 0) against a bot or a training target, or two (slots 0 and 1) for
  self-play (protocol 2). Playing against frozen past versions is done on the Python side: the trainer
  drives learner 1 with a snapshot and doesn't learn from it.
- No `observe_chaser` / `powerups` options; abilities are always on.
