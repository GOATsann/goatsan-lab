# Endless runner + RL: build plan (draft, nothing built yet)

Status: plan only. Nothing gets built or started until the user says go. The full plan is built in
one night (order in section 11); the user records as it happens (section 12).

Working name: **Lights-Out Run** (placeholder; see "Look"). Lives in `goatsan-lab/runner/`, next to
`car-racing/`, and reuses its cloud scripts, benchmark method and dashboard.

---

## 1. Goals (from the user)

1. Our own game, so it can run faster than real time.
2. Fast mode: headless, thousands of games in parallel in the cloud, for training and benchmarks.
3. Slow mode: real time, for viewers and for humans playing.
4. Training and benchmark runs save videos; runs appear in the existing training/benchmark dashboard.
5. Browser split screen: the AI on one side, a human on the other, same track.
6. If it works: deploy on the user's site so visitors can race the trained AI.
7. Open source.
8. Feels like a polished mobile endless runner (3 lanes, trains, barriers, coins, jump, roll), but
   is its own game: own world, characters, art, music and UI. Not a recreation of any existing game.

---

## 2. Architecture

### Decision: one deterministic game core in TypeScript

The same core runs in three places:

| Where | What runs | Speed |
|---|---|---|
| Browser | core + 3D renderer + input | real time (60 Hz) |
| Node, headless | core only, many games per process | as fast as the CPU allows |
| Video export | core replays a log, renderer draws it in headless Chrome | frame-stepped |

Why TypeScript and not Python or Rust:
- The browser is a first-class target (split screen, the public site). Writing the rules once in the
  renderer's language means there is no second implementation to keep in sync.
- A runner's rules are cheap (a few hundred objects, simple box collisions). Node can step a batch of
  games far faster than PPO can learn from them, so the bottleneck is the network, not the sim.
- It is easy to follow on camera.
- Fallback if throughput is ever too low: the same rules in Rust, compiled to WASM (browser) and a
  Python module (PyO3). Not worth the extra language and build pipeline up front.

Rejected: Python sim + JS port (two rule sets drift; every change needs a parity fix), and pixel
observations from the real renderer (slow, needs GPUs, and the agent would mostly learn to read art).

### Determinism (needed for replays, videos, fair benchmarks and the split screen)

- Fixed timestep: 60 ticks per second. Rendering interpolates; it never changes the state.
- One seeded PRNG (xoshiro128**) inside the core. No `Math.random`, no `Date`, no wall-clock time.
- Positions and speeds in fixed-point integers (for example millimetres), so Node and every browser
  produce bit-identical states.
- State hash per tick. Parity test in CI: the same seed + action log gives the same hash sequence in
  Node and in a headless browser.
- A replay is just `{ seed, game version, actions per decision }`. Videos, benchmarks and the
  split-screen "race the AI" are all built on replays.

### How Python trains on a TypeScript game

- `runner-server`: a Node process that owns N games (for example 64) and steps them all at once.
- Python side: a Gymnasium `VectorEnv` that talks to it over a local socket with one binary message
  per batch step (actions in, observations + rewards + dones out). Batching keeps the IPC cost per
  game tiny.
- Several Node processes per machine (one per core) cover a whole cloud machine.
- Same training stack as CarRacing: Stable-Baselines3 PPO, `runs.json`, `bench.py`, run numbers.

---

## 3. The game (rules that matter for RL)

- 3 lanes. The runner moves forward automatically and speeds up over time (the built-in curriculum).
- Obstacles: low barrier (jump), high barrier (roll under), standing train (change lane or climb via
  a ramp), moving train (oncoming, faster), gaps between obstacle groups.
- Coins in lines and arcs. Power-ups later (keep the first version small).
- Moves: left, right, jump, roll. A roll in the air ends the jump early (fast drop).
- Death on a front hit. A side hit while changing lanes bounces back once, then the next hit kills.
- Score = distance × multiplier + coins. This is the "game's own score", like CarRacing's return.
- Track generation from hand-made chunks chosen by the seeded PRNG, so every seed is a different but
  always-solvable run.

---

## 4. RL design

### Observation: what a player can see, as numbers (no pixels)

- A lane grid ahead of the runner: 3 lanes × 32 rows covering the visible distance (no peeking past
  what a human sees on screen). Per cell: one-hot object type (empty, low barrier, high barrier,
  train front, train body, ramp, coin, moving-train flag).
- Runner state: lane, lane-change progress, airborne height, rolling, current speed, ticks since the
  last action.
- Optional, later: the last 2 grids stacked, for oncoming-train speed (the same idea as frame stacking).

### Actions

Discrete(5): nothing, left, right, jump, roll. One decision every 4 ticks (15 per second), like
CarRacing's frame skip.

### Reward

- Start simple: + distance per decision, − 10 on death. Coins: small (+0.1) or zero at first.
- Things we expect to go wrong, which make good content: coin greed (risky lanes for coins), roll or
  jump spam, standing still in the safest lane when speed is low.
- The benchmark always uses the game's own score, never the shaped reward (the lesson from CarRacing).

### Fair play vs humans

- The AI sees only the visible distance, and acts at 15 decisions per second.
- Optional reaction delay (for example 150 ms) and difficulty levels made from earlier checkpoints:
  easy = an early checkpoint, hard = the final model.

---

## 5. Training and benchmark

- PPO, MLP policy (the grid is small; a tiny conv over lanes × rows is an option later).
- Cloud: the same c7i CPU machines and `run-cloud.sh` flow (train → benchmark → auto power-off).
- Progress race every N steps on a fixed seed, saved as a replay (and rendered to video, see 6).
- Benchmark: 100 fixed seeds, deterministic policy, game score. Metrics: mean ± 95% CI, median,
  distance, death cause histogram (which obstacle killed it), coins, survival time; paired
  head-to-head between runs. Same method and page as CarRacing.

---

## 6. Videos for training and benchmark runs

- Runs save replays (tiny JSON), not video, while training.
- A render step turns chosen replays into mp4 with the real browser renderer in headless Chrome,
  frame by frame (deterministic, so the video is exactly what happened). Runs after training on the
  same cloud machine, or locally through the heavy-job limiter.
- Rendered: the progress race every N steps, the best / median / worst benchmark seeds, and the
  first death of each run (great for fails compilations).
- Replays are also exported for the video side (shorts-agent), so the cinematic 3D replays can be
  re-rendered from any camera.

---

## 7. Dashboard

- Generalize the CarRacing dashboard to several projects: a project switcher (CarRacing, Runner).
  Training and Benchmark pages stay the same; the runner adds a "death causes" chart and replay
  videos.
- Runs keep numbers and descriptions in the runner's own `runs.json`.

---

## 8. Browser game, split screen, serving the model

- Renderer: three.js, stylized low-poly 3D, chase camera behind the runner, mobile-first
  (swipe controls) and keyboard on desktop.
- Split screen: two copies of the core with the same seed, side by side. The human plays left, the AI
  plays right. Who survives longer / scores more wins. Also a "ghost" mode: the AI runs as a
  translucent rival in your own lane view.
- AI in the browser: export the PPO policy to ONNX (a small MLP, well under 1 MB) and run it with
  ONNX Runtime Web (WASM backend). Same observation code as training, from the shared core, so the
  browser AI behaves exactly like the benchmarked one. A parity test checks the browser policy's
  actions against Python's on recorded states.

---

## 9. Deploy on the user's site

- Static build (HTML, JS, assets, ONNX model). No game server needed.
- On a subdomain, like the other personal-site projects (`surfer.theonlygoatsan.com`), via
  the existing Next.js/SST setup on AWS.
- Public by default, no login to play. If a "save my score" leaderboard comes later, it follows the
  site's login rules (login only on that action, WorkOS email code).
- No production deploy until the user explicitly says "deploy" after a local review.

---

## 10. Look and originality (open source, public)

What the genre shares, and is fine to use: 3 lanes, trains and barriers, coins, jump and roll, a chase
camera, bright stylized 3D, a fast mobile feel.

What we do not copy from any existing runner: its name, logo, characters, premise (who is chasing
whom), art, colours and textures, train and character designs, UI layout, fonts, sounds or music.

Our own direction, tied to the series: **a courier racing across a neon city at night to make it home
before lights-out.** Rooftop rail lines, glowing signs, rain reflections, a BULSHY.FM radio playing in
the world. Own character(s) designed for the brand. All art and audio made by us or CC0, listed in
`ASSETS.md` with sources. Code MIT; original art CC-BY 4.0.

---

## 11. Tonight: build order (full scope)

The user plans to build the full plan tonight. Nothing is cut; this is the order, so that something
works after every step and training runs in the background while the rest gets built.

| # | Step | Done when |
|---|---|---|
| 1 | TS core: 3 lanes, speed-up, low/high barriers, standing and moving trains, ramps and train roofs, coins, power-ups, side-hit bounce; fixed-point 60 Hz; state hash; seeded chunk generator | a seed + action list replays to the same hash; unit tests pass |
| 2 | Headless runner + steps/sec benchmark | steps per second per core printed (target > 50k) |
| 3 | Greybox browser renderer + keyboard/swipe | first playable in the browser |
| 4 | Determinism CI: Node vs headless Chrome, Firefox and WebKit | all replay hashes match |
| 5 | Node batch server + Python Gymnasium VectorEnv over a socket | `check_env` passes; PPO runs locally for a minute |
| 6 | Cloud training run 1 (train -> 100-seed benchmark -> replays -> videos -> power off) | runs in the background from here on |
| 7 | Full art and audio pass (neon night city, own character, UI, music, sound) | looks and sounds like a finished mobile runner |
| 8 | ONNX export + browser AI + split screen + ghost mode + difficulty levels (checkpoints) | human vs AI on one seed; browser/Python policy parity test passes |
| 9 | Dashboard project switcher (CarRacing / Runner), death causes, replay videos | runner runs and benchmarks visible |
| 10 | Reward fixes from what run 1 shows; further runs, each benchmarked | each run compared paired against the previous best |
| 11 | Leaderboard: "Save score" with the site's login rules (WorkOS email code, login only on that action) | scores saved and listed |
| 12 | Local review, then deploy when the user says so | live on `surfer.theonlygoatsan.com` |

---

## 12. Recording

The user records as things happen and the video is cut at the end. Training and benchmark runs save
replays and rendered videos as planned (section 6), and replays are exported for cinematic re-renders.

---

## 13. Open questions for the user

1. Name and character: own name instead of the placeholder?
2. Power-ups in version 1, or after the first trained AI?
3. Split screen on phones too, or desktop only at launch?
4. Leaderboard (needs login) at launch, or later?
