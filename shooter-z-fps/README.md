# Shooter Z

**Can you beat AI?** A laser-tag first-person shooter with robots, in your browser. Every opponent is an
AI that sees only what you could see: no wall hacks. Two small maps, 1v1, 2v2 (you and an AI teammate) or
1 vs 3 free-for-all, four characters with one ability each.

**Play:** [shooterz.theonlygoatsan.com](https://shooterz.theonlygoatsan.com) (desktop with mouse and keyboard, or a
phone held sideways; on a phone in portrait you can watch AI vs AI).

> **New to this code?** Open this folder with an AI coding agent (Claude Code, Cursor, GitHub Copilot or
> similar) and ask it to walk you through it. For example: *"Explain how src/core keeps the game
> deterministic, what the bots can and cannot see, and how the batch server will feed RL training."*

## How to play

New here? Press **Start tutorial** on the menu (it is suggested on your first visit): nine short steps on
the army base (look, move, jump and crouch, shoot a target, a headshot, reload, your Special Move,
eliminate a still target, then a slow training bot that shoots back). Each step completes when you do
it; N skips a step.

First to 10 eliminations wins (you can change the limit). No round timer. When you're eliminated the
camera pulls back so you see your robot go down, the robot that got you is highlighted and named, and
after 2.5 s you respawn in first person with 2 s of spawn protection: you take no damage and your robot
flickers faintly. It always ends after 2 s, or sooner when you fire. (It is not a Special Move; Bulwark's
shield is.)

| Key | Action |
|---|---|
| Mouse | aim (click the game to lock the mouse; Esc to pause) |
| Left click | fire (hold for continuous fire) |
| W A S D | move |
| Space | jump |
| C (or Ctrl) | crouch (hold). Ctrl+W closes the browser tab, so C is the safer key |
| R | reload |
| E or right click | your character's Special Move |
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
- Friend or foe: a **green arrow** floats over teammates (always) and a **red arrow** over an opponent only
  while you can see it or it is revealed (hit, scan, standing still), never through walls otherwise. The
  minimap uses the same green and red. Every character keeps its own colours; there is no team tinting.
  The one body effect is Echo's Scan: the enemies it exposes glow as red silhouettes through walls for
  1.5 s, for Echo's whole team.

**Characters** (same health, speed and laser; the Special Move is the only difference). Click a character
on the menu to see it turning, with its Special Move and cooldown; every few seconds it performs the move
with its effects while the move's name flashes (Dash: speed lines and an afterimage trail; Bulwark: the
shield; Echo: a scan ring with a radar sweep; Wisp: a shimmer, then near-invisible).

| Character | Special Move | What it does | Cooldown |
|---|---|---|---|
| Dash | Dash | A quick burst (~2.8 m) in the direction you're moving | 6 s |
| Bulwark | Shield | A frontal energy shield for 2 s that stops lasers; you can still shoot | 12 s |
| Echo | Scan | Shows your team every enemy within 20 m for 1.5 s as red silhouettes through walls (plus red arrows and the minimap) | 15 s |
| Wisp | Cloak | Nearly invisible for 3 s (visible within 6 m); firing breaks it | 15 s |

The AI opponents get random characters. Each character is a rigged, animated 3D model (aim, run, strafe,
jump, crouch, hit, eliminated, spawn and its Special Move) with its glow in the robot's slot colour. The
models are not in this repo (see [ASSETS.md](ASSETS.md)); without them the game uses simple stand-in robots.

**On a phone**, turn it sideways to play with touch controls (in portrait the menu says "Rotate your
phone to play" and offers **Watch AI vs AI**, a live bot match with follow, robot's-eyes, overview and free
cameras; the same mode is on the desktop menu). Touch controls, all usable at once (multi-touch):

| Touch | Action |
|---|---|
| Left thumb anywhere on the left side | a floating stick: move (8 directions; the game has one run speed) |
| Drag on the right side | aim (Look speed on the menu) |
| Firing: **Simple** (the phone default) | the game fires for you while the crosshair is on a visible enemy; no Fire buttons |
| Firing: **Advanced** (menu) | a big Fire button (bottom right) that also aims: drag while holding it, like the big mobile shooters; and a smaller Fire button on the left, above the stick, so the left thumb fires while the right thumb aims |
| Special Move button (with cooldown ring) | your character's Special Move |
| Jump, Crouch (tap to toggle), R | jump, crouch, reload (it also reloads by itself when empty) |
| II (top right) | pause |

Starting play asks for fullscreen and a landscape lock where the browser allows it (not on iPhone
Safari; the layout uses `dvh` units so the address bar doesn't cover anything). Touch devices start on
Low graphics (changeable on the menu). The tutorial works with touch and shows touch hints.

**The AI.** Every robot that isn't you (opponents, your 2v2 teammate, both sides in Watch AI vs AI) is the
trained AI: a PPO policy with LSTM memory that taught itself to play against the rule bots and itself
(see "The AI plan" below). It runs in your browser with onnxruntime-web (WASM, in its own worker), deciding
every 3 ticks from exactly the observation and actions it was trained with. There is one AI level for now;
the menu shows "Loading the AI..." until the model is here, and "Couldn't load the AI. Retry" if it fails.
The model file (`public/models/shooter-ai.onnx` + `.json`, about 5.5 MB) is not in this repo; it comes from
the training side (Hugging Face).

The hand-written **rule bots** (below) are kept for testing and training only: add `?rulebots` to the URL
to play against them, with their Easy / Normal / Hard levels on the menu. The tutorial's training target is
one of them, scripted.

### Tuning difficulty

All bot difficulty numbers are in one file, [`src/core/difficulty.ts`](src/core/difficulty.ts). The weapon
numbers (points per hit, fire rate, clip, reload) are in [`src/core/config.ts`](src/core/config.ts). Bump
`VERSION` in `src/core/game.ts` after retuning (old replays won't match). Current values:

| Setting (`difficulty.ts`) | Easy | Normal | Hard |
|---|---|---|---|
| Reaction time before aiming at a new target (`reactionTicks`, 1/60 s) | 30 (0.5 s) | 17 (0.28 s) | 10 (0.17 s) |
| Max turn speed (`turnPerTick` x 60) | 2.6 rad/s | 5 rad/s | 8.5 rad/s |
| Steady aim wobble (`aimNoise`, rad) | 0.03 | 0.014 | 0.007 |
| Extra error on the first shots (`firstShotNoise`, rad) | 0.09 | 0.055 | 0.03 |
| Goes for the head closer than (`headDist`) | never | 9 m | 22 m |
| Fires when error < part size x (`fireTol`) | 1.7 | 1.25 | 1.0 |
| Strafes while fighting (`strafeChance`) | 30% | 75% | 100% |
| Crouch-fires at range (`crouchFire`) | 0% | 20% | 35% |
| Seeks cover below health (`coverHealth`) | 30 | 40 | 45 |
| Leads moving targets (`lead`) | 0 | 0.5 | 1 |

| Weapon (`config.ts`) | Value |
|---|---|
| `BASE_DAMAGE` (torso hit) | 20 |
| `PART_MULT` head / torso / legs | 2.5 / 1 / 0.75 (50 / 20 / 15 points) |
| `MAX_HEALTH` | 100 |
| `FIRE_TICKS` | 8 (7.5 shots per second) |
| `CLIP` / `RELOAD_TICKS` | 24 / 90 (1.5 s) |
| `SPREAD_BASE` / `SPREAD_MOVE` / `SPREAD_AIR` | 0.002 / 0.012 / 0.03 rad |
| Health regen | after 5 s, 15 per second |

Playtest note: the bots currently feel too strong; the plan is to tune points per shot and these limits.

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
frame), also with the four rigged characters in a 2v2. The code is about 230 KB gzipped (three.js is most of
it); the four character models add about 4.2 MB (about 1 MB and 14.5k triangles each). Everything else
(maps, textures, sound) is generated in code.

Graphics: **Normal** (default: soft shadows from one sun light, fake ambient occlusion, glow on lasers,
anti-aliasing, pixel ratio capped at 1.5) or **Low** (no shadows, no anti-aliasing, pixel ratio 1, fewer
props and particles) for computers that struggle. Pick it on the menu.

## Deploy

A static site (S3 + CloudFront) with SST, like the runner: `npx sst deploy --stage prod`. Local settings go in
a gitignored `.env` next to `sst.config.ts` (`AWS_PROFILE`, and `SHOOTERZ_CERT_ARN` for the domain once its
ACM certificate is issued). The AI model, the character models and the sounds are not in git: put them in
`public/` before deploying (ASSETS.md). Hashed files (`assets/`) are cached for a year; everything that keeps
its name (pages, model, characters, sounds) revalidates, so a new AI model reaches players within minutes.

## How it's built

Same architecture as [Lights-Out Surfer](../runner/):

- **One deterministic core** (`src/core/`): fixed 60 Hz ticks, a seeded random generator, its own
  sin/cos/atan2 (so results are bit-identical in Node and every browser), a state hash. No DOM, no clock.
  - `game.ts` the rules: movement and collision, hitscan lasers against head/torso/legs hitboxes,
    damage, reload, respawn and spawn protection, reveal timers, scoring, teams, abilities.
  - `maps.ts` both maps as solid boxes, point-symmetric so no side is better. `world.ts` ray casts and
    overlap tests on a broadphase grid. `nav.ts` a walk grid and A* for the bots.
  - `actions.ts` **the action interface** for everyone (human, bot, later the RL agent): move,
    strafe, jump, crouch, yaw/pitch deltas capped by a turn speed, fire, reload, ability.
  - `obs.ts` **the observation**: foveated labelled rays (a wide 25x7 grid plus a dense 9x9 patch at
    the crosshair, 256 rays, each with distance + label: wall, cover, floor, enemy head/torso/legs,
    teammate, enemy shield), memory slots from the minimap rules (outline, ping, idle reveal, scan,
    teammate), and own state (health, ammo, ability cooldown, damage direction, ...). Cloaked enemies
    only show up in rays within 6 m.
  - `bot.ts` **heuristic bots** (their difficulty numbers live in `difficulty.ts`): patrol -> notice (sight, minimap pings, outlines, damage direction) ->
    engage (reaction delay, capped turn speed, aim noise, head when close, strafing) -> cover when hurt ->
    reposition. Team-aware in 2v2 (stays near its teammate, picks the enemy closest to it, steps out of
    its line of fire). Ability rules: dash out of trouble, shield in a losing fight, scan when lost, cloak to
    flank. Bots read only their Observation and the map layout, never the game state.
  - `match.ts` a match = game + who controls each robot; **replays** are the seed, the options and the
    non-bot inputs, and rebuild the exact match.
- **Browser** (`src/web/`): three.js renderer (`gameview.ts`, `mapview.ts`, `character.ts` for the rigged
  characters, `robot.ts` for the stand-ins, `fx.ts`), HUD,
  input with pointer lock, synthesized sound, spectator and free cameras, the tutorial (`tutorial.ts`)
  and the character preview (`charpreview.ts`). `capture.html` renders build
  stages and matches frame by frame for videos (`test/tools/capture.mjs`).
- **Headless** (`src/headless/`): the speed test, a match runner with replay check, and the batch server
  for training (protocol in [PROTOCOL.md](PROTOCOL.md)).

## The AI plan

The design notes for the learning AI are in the BULSHY.FM ideas folder (not in this repo). In short:

**Done (phase 1, the game):** the deterministic core, both maps, all modes, characters and abilities,
the observation and action interfaces the RL agent will use, fair heuristic bots that use exactly those
interfaces, replays, the batch server, tests.

**Done (phase 2, first AI):** the trained AI plays in the browser (model A at 28M steps: wins 80 / 57 / 47 %
against the Easy / Normal / Hard rule bots). The training code is in `train/`.

**The plan for the AI that learns (phase 2):**
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
- Then: run the trained policy in the browser with onnxruntime-web as the opponent, "Can you beat AI?"
  (done: `src/web/trained-ai.ts`). Next: per-level models, and 2v2 / 1 vs 3 training.

## Credits

Code: MIT ([LICENSE](../LICENSE)). The four character models were made for this project and are all
rights reserved (not included, not part of the MIT code). Everything else you see and hear is generated in
code; the only other external assets are two fonts loaded from Google Fonts. Details in
[ASSETS.md](ASSETS.md).
