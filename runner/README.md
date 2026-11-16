# Lights-Out Surfer

An endless runner set in a neon city at night. Dodge trains and barriers, grab coins and power-ups,
and don't let the Blackout ghost catch you. The game has its own AI, trained with reinforcement
learning, that you can race in a split screen.

**Play:** [surfer.theonlygoatsan.com](https://surfer.theonlygoatsan.com)

## How to play

- Change lanes with ← → (or A D), jump with ↑ (W), roll with ↓ (S). On a phone, swipe.
- Running into a barrier or into the side of a train is a stumble: you slow down and the Blackout
  ghost closes in. Stumble again while it's close and it catches you. Running head-on into a train
  ends the run.
- Power-ups: Magnet, Spring shoes, Shield (absorbs one hit) and x2 coins.
- The game gets harder for the whole run, with no ceiling. Pick Easy, Normal or Hard to set where it starts.

## Run it locally

```
npm ci
npm run dev          # http://localhost:5180
npm test             # rules, determinism, the batch server
npm run speed        # how fast the game runs headless on one core
npm run parity       # same replays give the same result in Node, Chromium, Firefox and WebKit
```

Optional music: put an MP3 at `public/audio/music.mp3` (not included, see [ASSETS.md](ASSETS.md)).

The trained AI opponents are not in this repo either. Race the AI loads them from
`public/models/policy-{easy,normal,hard}.onnx` (with a `.json` next to each); without them it uses a
built-in stand-in bot. To use your own, train one (see `train/`) and run
`npm run publish-model -- <run> [checkpoint steps] --as easy|normal|hard`.

## How it's built

- **One deterministic core** (`src/core/`): fixed 60 Hz ticks, integer physics, a seeded random
  generator and a state hash. The same seed and inputs give the same run in Node and every browser,
  so replays, benchmarks and the split-screen race are all exact.
- **Headless training**: `src/headless/server.ts` steps many games per message for the Python
  trainer (protocol in [PROTOCOL.md](PROTOCOL.md)); the trainer lives in `train/`.
- **Browser**: three.js renderer (`src/web/`), replays to video (`src/headless/render-replay.ts`), and
  the trained policy running in the browser with onnxruntime-web.
- The plan for the whole build is in [PLAN.md](PLAN.md).

Code: MIT. Kai and Nova models: CC-BY 4.0. See the [licence](../LICENSE) and [ASSETS.md](ASSETS.md).
