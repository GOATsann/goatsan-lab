# Shooter Z

**Can you beat AI?** A laser-tag first-person shooter with robots, in your browser. Every opponent is an
AI that sees only what you could see: no wall hacks. Two small maps, 1v1, 2v2 (you and an AI teammate) or
1 vs 3 free-for-all, four characters with one ability each.

**Play:** run it locally for now (see below). It is not deployed yet.

> **New to this code?** Open this folder with an AI coding agent (Claude Code, Cursor, GitHub Copilot or
> similar) and ask it to walk you through it. For example: *"Explain how src/core keeps the game
> deterministic, what the bots can and cannot see, and how the batch server will feed RL training."*

## How to play

First to 10 eliminations wins (you can change the limit). No round timer: you respawn after 2.5 s with
2 s of spawn shield (firing ends it).

| Key | Action |
|---|---|
| Mouse | aim (click the game to lock the mouse; Esc to pause) |
| Left click | fire (hold for continuous fire) |
| W A S D | move |
| Space | jump |
| C (or Ctrl) | crouch (hold). Ctrl+W closes the browser tab, so C is the safer key |
| R | reload |
| E or right click | your character's ability |
| Tab | scoreboard |
| V | free camera (for filming); V again to go back |
| H | hide the HUD |
| M | mute |

**Damage by body part:** head x2.5 (50), torso x1 (20), legs x0.75 (15). 100 health, health comes back
5 s after your last hit. 24 shots per clip, 1.5 s reload. Moving and jumping make you less accurate,
crouching more.

**Reveal rules** (the same for you and the bots):
- A robot you hit stays outlined for you for 2 s, even behind cover.
- Firing shows you on everyone's minimap for 1 s.
- Standing still without firing for 15 s reveals you to everyone for 2 s.
- In 2v2 your teammate is always outlined and on your minimap. There is no friendly fire.

**Characters** (same health, speed and laser; the ability is the only difference):

| Character | Ability | What it does | Cooldown |
|---|---|---|---|
| Zip | Dash | A quick burst (~2.8 m) in the direction you're moving | 6 s |
| Brick | Shield | A frontal energy shield for 2 s that stops lasers; you can still shoot | 12 s |
| Sonar | Scan | Shows your team every enemy within 20 m for 1.5 s, through walls | 15 s |
| Wisp | Cloak | Nearly invisible for 3 s (visible within 6 m); firing breaks it | 15 s |

The AI opponents get random characters. The robots are a stand-in look (a per-character accessory); the
final character art comes later.

**On a phone** you can't play (it needs a mouse and keyboard), but you can **Watch AI vs AI**: a live bot
match with follow, robot's-eyes, overview and free cameras. The same mode is on the desktop menu.

**AI level** (Easy / Normal / Hard) sets the bots' human-like limits: reaction time (0.5 / 0.28 / 0.17 s),
max turn speed, aim wobble, how close they go for the head, and how readily they strafe and take cover.

## Run it locally

```
npm ci
npm run dev          # http://localhost:5190  (?fps shows a frame-time counter, ?graphics=low forces Low)
npm test             # core rules, determinism, abilities, observation, batch server
npm run speed        # how fast matches run headless on one core:  npm run speed -- 10 duel
npm run match -- --seed 7 --mode duel --map base --skill hard   # one bot match, saves and checks its replay
npm run replay -- runs/match-base-duel-7.json                  # rebuild a match from seed + inputs
npm run server -- --port 7001   # batch server for RL training (PROTOCOL.md)
npm run build        # static site in dist/
```

Measured on the build machine (Apple silicon Mac, one core): **16,000 game steps per second with four
bots** (268x real time, every bot casting 256 labelled rays per decision) and **35,000 steps per second in
1v1** (591x). In headless Chromium at 1600x900 on Normal graphics the game holds 60 fps (16.7 ms per
frame). The whole download is about 230 KB gzipped (three.js is most of it): no textures, models or sound
files, everything is generated in code.

Graphics: **Normal** (default: soft shadows from one sun light, fake ambient occlusion, glow on lasers,
anti-aliasing, pixel ratio capped at 1.5) or **Low** (no shadows, no anti-aliasing, pixel ratio 1, fewer
props and particles) for computers that struggle. Pick it on the menu.

## How it's built

Same architecture as [Lights-Out Surfer](../runner/):

- **One deterministic core** (`src/core/`): fixed 60 Hz ticks, a seeded random generator, its own
  sin/cos/atan2 (so results are bit-identical in Node and every browser), a state hash. No DOM, no clock.
  - `game.ts` the rules: movement and collision, hitscan lasers against head/torso/legs hitboxes,
    damage, reload, respawn and spawn shield, reveal timers, scoring, teams, abilities.
  - `maps.ts` both maps as solid boxes, point-symmetric so no side is better. `world.ts` ray casts and
    overlap tests on a broadphase grid. `nav.ts` a walk grid and A* for the bots.
  - `actions.ts` **the action interface** for everyone (human, bot, later the RL agent): move,
    strafe, jump, crouch, yaw/pitch deltas capped by a turn speed, fire, reload, ability.
  - `obs.ts` **the observation**: foveated labelled rays (a wide 25x7 grid plus a dense 9x9 patch at
    the crosshair, 256 rays, each with distance + label: wall, cover, floor, enemy head/torso/legs,
    teammate, enemy shield), memory slots from the minimap rules (outline, ping, idle reveal, scan,
    teammate), and own state (health, ammo, ability cooldown, damage direction, ...). Cloaked enemies
    only show up in rays within 6 m.
  - `bot.ts` **heuristic bots**: patrol -> notice (sight, minimap pings, outlines, damage direction) ->
    engage (reaction delay, capped turn speed, aim noise, head when close, strafing) -> cover when hurt ->
    reposition. Team-aware in 2v2 (stays near its teammate, picks the enemy closest to it, steps out of
    its line of fire). Ability rules: dash out of trouble, shield in a losing fight, scan when lost, cloak to
    flank. Bots read only their Observation and the map layout, never the game state.
  - `match.ts` a match = game + who controls each robot; **replays** are the seed, the options and the
    non-bot inputs, and rebuild the exact match.
- **Browser** (`src/web/`): three.js renderer (`gameview.ts`, `mapview.ts`, `robot.ts`, `fx.ts`), HUD,
  input with pointer lock, synthesized sound, spectator and free cameras. `capture.html` renders build
  stages and matches frame by frame for videos (`test/tools/capture.mjs`).
- **Headless** (`src/headless/`): the speed test, a match runner with replay check, and the batch server
  for training (protocol in [PROTOCOL.md](PROTOCOL.md)).

## The AI plan

The design notes for the learning AI are in the BULSHY.FM ideas folder (not in this repo). In short:

**Done (phase 1, the game):** the deterministic core, both maps, all modes, characters and abilities,
the observation and action interfaces the RL agent will use, fair heuristic bots that use exactly those
interfaces, replays, the batch server, tests.

**Next (phase 2, the AI that learns):**
- PPO with memory (LSTM). Rays through a small 1D/2D conv, memory slots and own state through an MLP, into
  an LSTM, with heads for movement (discrete), jump/crouch/fire/reload/ability, and aim (continuous, clipped
  to the turn speed); a value head.
- Curriculum: still targets -> moving targets -> heuristic bots (Easy -> Hard) -> self-play against a pool of
  its own past versions, keeping some easier matches mixed in.
- Rewards: win/lose the match as the main signal; damage dealt (headshots worth more) and damage taken as
  helpers that fade out; small costs for wasted shots and long stretches with no progress (anti-camping).
  Training episodes get a time cut-off (truncation, not a loss); players never have a round timer.
- 2v2 needs **shared team rewards** (the batch server already reports `teamKills` / `teamDeaths`), and the
  server will grow a multi-agent mode (several learner slots per match) designed with the training side.
- Then: run the trained policy in the browser with onnxruntime-web as the opponent, "Can you beat AI?".

## Credits

Code: MIT ([LICENSE](../LICENSE)). Everything you see and hear is generated in code; the only external
assets are two fonts loaded from Google Fonts. Details in [ASSETS.md](ASSETS.md).
