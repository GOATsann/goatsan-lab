# goatsan-lab

[![tests](https://github.com/GOATsann/goatsan-lab/actions/workflows/tests.yml/badge.svg)](https://github.com/GOATsann/goatsan-lab/actions/workflows/tests.yml)

Things I build on camera for **BULSHY.FM** ("Build Until Lights-out, Seriously Hoping You Follow Me"),
by [@_goatsan](https://www.instagram.com/_goatsan/). Everything here is free to use and learn from.

| Project | What it is | Try it |
|---|---|---|
| [runner/](runner/) | **Lights-Out Surfer**, an endless runner with its own AI. A deterministic TypeScript game that runs in the browser and, headless, about 60,000 times faster than real time for training. You can race the trained AI in a split screen. | [surfer.theonlygoatsan.com](https://surfer.theonlygoatsan.com) |
| [shooter-z-fps/](shooter-z-fps/) | **Shooter Z. Can you beat AI?** A laser-tag first-person shooter against AI robots in the browser: 1v1, 2v2 and 1 vs 3, two maps, four characters with one ability each. Every robot is an AI that taught itself to play (PPO with memory), running in your browser and seeing only what a player sees, on a deterministic core that runs headless for training. | [shooterz.theonlygoatsan.com](https://shooterz.theonlygoatsan.com) |
| [car-racing/](car-racing/) | **The car that taught itself to drive.** PPO on Gymnasium's CarRacing from pixels, with a benchmark that compares reward ideas fairly on the same 100 tracks. | Run it locally (see its README) |

All my free builds: [theonlygoatsan.com/free](https://www.theonlygoatsan.com/free)

## New to this code? Let an AI walk you through it

The quickest way in is to open this repo with an AI coding agent (Claude Code, Cursor, GitHub Copilot
or similar) and ask it to explain the project to you. It can read every file and answer follow-up
questions, so you don't have to work it all out alone. For example:

> Explain how the runner/ project works, from the game rules to the AI training, and show me how to run it.

Each project's README has a starter question like this one.

Code: MIT. Art in this repo made for these projects: CC-BY 4.0. The Kai and Nova character models are not included. See [LICENSE](LICENSE).

## Tests

Every project has tests, and GitHub Actions runs all of them on every push (the badge at the top).

| Project | Tests | Run locally |
|---|---|---|
| Shooter Z | unit (game core, batch server), e2e in real browsers (desktop Chromium, iPhone WebKit, Android Chromium) | `cd shooter-z-fps && npm test && node test/e2e/fetch-models.mjs && npm run build && npx playwright test` |
| Lights-Out Surfer | unit (game core, batch server), e2e on the same three devices | `cd runner && npm test && npm run build && npx playwright test` |
| CarRacing, dashboard, explainers | reward wrappers on the real game, dashboard exporter, every page's script and links | `cd car-racing && python -m pytest tests -q` |

Each game has a `USER_STORIES.md`: every control and flow, with the expected result and which test covers it.
Rules: run the whole suite after any change (not only the tests near it); every bug a user finds becomes a
story with a test; a fix is done when its test passes.
