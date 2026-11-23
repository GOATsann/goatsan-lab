# Lights-Out Surfer: user stories

This file is the spec for the automated Playwright end-to-end suite. Every story describes one thing a
player can do and what they must see, in terms a test can check: element ids, visible text, a test
hook value or the absence of page errors. The suite runs on three projects: desktop Chromium
(1280x800), iPhone WebKit (`devices["iPhone 13"]`, portrait 390x844 and landscape 844x390) and Android
Chromium (`devices["Pixel 7"]`, portrait and landscape).

How to use it:

- A story with `Automated: no` has no test yet. When a test is written for it, change the line to
  `Automated: yes (<test file>)`.
- Every bug a user finds gets a story here, with the fixing commit hash in `Source`, before or together
  with the fix. Stories from the design have `Source: design`.
- Run the whole suite after any change to the game, the race, watch or replay pages, the sound code, the
  scores code or the personal site's `/auth/signin` and `/api/surfer/*` routes, not only the tests that
  look related.
- A story that starts with "Unverified:" describes behaviour that the code suggests but nobody has
  confirmed on a real device. Confirm it, then remove the word or rewrite the story.
- Every test also asserts that no `pageerror` fired and no `console.error` was logged, unless the story
  says otherwise. This rule is not repeated in each story.

Pages: `/` (index.html, the solo game), `/race.html` (Race the AI), `/watch.html` (Watch the AI),
`/replay.html` (replays and video rendering). The leaderboard API and sign-in live on the main site:
`https://www.theonlygoatsan.com` in production and `http://localhost:3100` when the game runs on
localhost. Tests mock that origin with `page.route` (see `test/tools/save-flow.mjs`).

Test hooks:

- `window.game()` on `/`: the current `Game` (`tick`, `dead`, `deathCause`, `lane` 0-2, `grounded`,
  `rolling`, `y`, `vy`, `score`, `meters`, `coins`, `magnetTicks`, `springTicks`, `shieldTicks`,
  `doubleTicks`, `stumbleCount`, `chaserTicks`, `chaserGap`, `slowTicks`, `heat`, `seed`,
  `options.level`, `options.stumblesToCatch`, `obstacles`, `pickups`, `replay()`). Tests may write to
  these fields to force a state, as the existing tools do.
- `window.sfx` on `/`: `state` ("none", "suspended", "running", "interrupted"), `muted`, `musicOn`,
  `played` (counts per sound name), private `["ctx"]` and `["musicStarted"]`.
- `window.race()` on `/race.html`: `{ you, ai, phase, clock, driver }`, where `phase` is "loading",
  "count", "race" or "done" and `driver` is the AI's label ("stand-in bot" when no model is served).
- `window.watch()` on `/watch.html`: `{ game, runs, best, driver, lastAction }`.
- `window.replayApi` and `window.renderer` on `/replay.html`.
- URL parameters: `?seed=N` fixes the track on `/`, `/race.html` and `/watch.html`; `?debug` shows the
  track number on `/`; `?level=0|1|2` on `/watch.html`; `?src=<url>` and `?clean` on `/replay.html`.
- localStorage keys (all prefixed `lights-out:`): `level`, `name`, `runner`, `muted`, `music`,
  `pending-score`.

---

## 1. Loading and the start screen

### LS-001 The game page loads to the start card
- Platforms: desktop | phone landscape | phone portrait
- State: start
- Steps:
  1. Open `/`.
  2. Wait until `typeof window.game === "function"`.
- Expected: `#overlay` is visible. `#title` reads "Lights-Out Surfer" and `#sub` reads the tagline
  "Make it home before lights-out." The buttons `#play` ("Run"), `#race` ("Race the AI"), `#watch` and
  `#boardBtn` are visible. A canvas fills the window behind the card. `#saveRow` is hidden.
  `window.game().tick` is 0.
- Check: `#overlay`, `#title`, `#sub`, `#play`, `#race`, `#watch`, `#boardBtn`, `#saveRow`, `window.game().tick`
- Source: design
- Automated: no

### LS-002 The page title is the game name
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. Open `/`, `/race.html` and `/watch.html` in turn.
- Expected: `document.title` is "Lights-Out Surfer" on `/`, "Lights-Out Surfer · Race the AI" on the race
  page and "Lights-Out Surfer · Watch the AI" on the watch page.
- Check: `page.title()`
- Source: design
- Automated: no

### LS-003 The world animates behind the start card without the run starting
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. Open `/?seed=7` and wait 3 seconds.
- Expected: The canvas has a non-zero size equal to the window size. `window.game().tick` is still 0,
  so the run has not started on its own.
- Check: canvas `clientWidth`/`clientHeight` vs `innerWidth`/`innerHeight`, `window.game().tick`
- Source: design
- Automated: no

### LS-004 The start card shows the controls hint
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. Open `/`.
- Expected: `.hint` is visible and reads "← → change lane · ↑ jump · ↓ roll · or swipe". There is no
  other how-to screen in the game; this line is the whole tutorial.
- Check: `.overlay .hint` text
- Source: design
- Automated: no

### LS-005 Run starts the game from the card
- Platforms: desktop | phone landscape | phone portrait
- State: start
- Steps:
  1. Open `/?seed=7`.
  2. Click (desktop) or tap (phone) `#play`.
  3. Wait 1 second.
- Expected: `#overlay` is hidden, `window.game().tick` is greater than 0 and rising, and
  `window.game().dead` is false. The HUD (`.hud`) is visible.
- Check: `#overlay[hidden]`, `window.game().tick`, `.hud`
- Source: design
- Automated: no

### LS-006 Space or Enter starts the game from the card
- Platforms: desktop
- State: start
- Steps:
  1. Open `/?seed=7` and click an empty part of the page so the name field is not focused.
  2. Press Space. (Repeat the story with Enter.)
- Expected: `#overlay` is hidden and `window.game().tick` rises.
- Check: `#overlay[hidden]`, `window.game().tick`
- Source: design
- Automated: no

### LS-007 Enter in the name field starts the game
- Platforms: desktop
- State: start
- Steps:
  1. Open `/`.
  2. Click `#name`, type "Ike" and press Enter.
- Expected: The run starts (`#overlay` hidden, tick rising) and `localStorage["lights-out:name"]` is
  "Ike".
- Check: `#overlay[hidden]`, `window.game().tick`, localStorage
- Source: design
- Automated: no

### LS-008 Typing in the name field does not steer, start or mute
- Platforms: desktop
- State: start
- Steps:
  1. Open `/` with sound and music on.
  2. Focus `#name` and type "Max Wasd Ms", including a space.
- Expected: The field contains "Max Wasd Ms". The run did not start (`#overlay` visible, tick 0). Sound
  and music are still on (`window.sfx.muted` false, `window.sfx.musicOn` true), so the letter M did not
  mute.
- Check: `#name` value, `#overlay`, `window.game().tick`, `window.sfx.muted`, `window.sfx.musicOn`
- Source: design
- Automated: no

---

## 2. Runner, name and level

### LS-009 The runner picker cycles between Kai and Nova
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. Open `/` with empty localStorage and wait for `#charName` to read "Kai".
  2. Click `#next`, then `#next` again, then `#prev`.
- Expected: `#charName` reads "Nova", then "Kai", then "Nova" (the list wraps). The CSS variable
  `--accent` on `<html>` changes with the runner (`#4fe3ff` for Kai, `#ff7a63` for Nova), so the Run
  button colour changes.
- Check: `#charName`, `getComputedStyle(document.documentElement).getPropertyValue("--accent")`
- Source: design
- Automated: no

### LS-010 The chosen runner is remembered
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. Open `/`, click `#next` so Nova is shown.
  2. Reload the page.
- Expected: `#charName` reads "Nova" after the reload and `localStorage["lights-out:runner"]` is "girl".
- Check: `#charName`, localStorage
- Source: design
- Automated: no

### LS-011 The name is remembered and capped at 16 characters
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. Open `/`, fill `#name` with "Ike".
  2. Reload.
  3. Try to type 20 characters into `#name`.
- Expected: After the reload `#name` holds "Ike". The field never holds more than 16 characters.
- Check: `#name` value, `maxlength` attribute
- Source: design
- Automated: no

### LS-012 The level picker selects one level and shows the AI note
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. Open `/` with empty localStorage.
  2. Click `[data-level="0"]`, then `[data-level="2"]`.
- Expected: With empty storage Normal is selected (`[data-level="1"]` has `aria-checked="true"`). After
  each click exactly one of the three buttons has `aria-checked="true"`: Easy, then Hard.
  `.level-info` is visible and reads "This also sets how good the AI is."
- Check: `[data-level][aria-checked="true"]`, `.level-info` text
- Source: 492d2e8
- Automated: no

### LS-013 The chosen level is remembered and used for the run
- Platforms: desktop | phone portrait
- State: start → running
- Steps:
  1. Open `/`, click `[data-level="2"]`.
  2. Reload, then click `#play`.
- Expected: After the reload Hard is still checked and `localStorage["lights-out:level"]` is "2". The
  new run has `window.game().options.level === 2`.
- Check: `[data-level="2"][aria-checked]`, localStorage, `window.game().options.level`
- Source: design
- Automated: no

### LS-014 A higher start level starts faster
- Platforms: desktop
- State: running
- Steps:
  1. Play 5 seconds with no input on `/?seed=7` at Easy, read `window.game().meters`.
  2. Repeat at Hard with the same seed.
- Expected: The Hard run has covered more metres than the Easy run in the same time (the core starts
  Hard at a higher speed), and `window.game().heat` is higher on Hard.
- Check: `window.game().meters`, `window.game().heat`
- Source: design
- Automated: no

### LS-015 A stored level outside 0-2 falls back to Normal
- Platforms: desktop
- State: start
- Steps:
  1. Set `localStorage["lights-out:level"] = "7"` and reload `/`.
- Expected: Normal is checked and the next run has `options.level === 1`. No page error.
- Check: `[data-level="1"][aria-checked="true"]`, `window.game().options.level`
- Source: design
- Automated: no

---

## 3. Sound and music

### LS-016 Sound and music icons are in the corner on every page
- Platforms: desktop | phone landscape | phone portrait
- State: start / running / race / watching
- Steps:
  1. Open `/`, `/race.html` and `/watch.html`.
- Expected: Each page has `.audioctl` with two buttons, `[data-k="sound"]` and `[data-k="music"]`,
  in the bottom-right corner, visible and not covered by the card or the watch panel. Their
  `aria-label` reads "Sound on"/"Sound off" and "Music on"/"Music off" to match the state.
- Check: `.audioctl button[data-k]`, `aria-label`, `aria-pressed`, bounding boxes do not overlap `.card` or `#panel`
- Source: d71d569
- Automated: no

### LS-017 Audio starts on the first click or tap (desktop)
- Platforms: desktop
- State: start → running
- Steps:
  1. Open `/` and wait 2.5 seconds without input.
  2. Click `#play`.
- Expected: Before the click `window.sfx.state` is "none". Within 1 second after the click it is
  "running", and if the music file is served, `window.sfx["musicStarted"]` is true.
- Check: `window.sfx.state`, `window.sfx["musicStarted"]`
- Source: 03502ea
- Automated: no

### LS-018 Audio starts on the first tap on iPhone
- Platforms: phone portrait (WebKit, iPhone)
- State: start → running
- Steps:
  1. Open `/` in the iPhone WebKit project and wait 2.5 seconds.
  2. Tap `#play`.
- Expected: Within 1 second `window.sfx.state` is "running" and music has started
  (`window.sfx["musicStarted"]` true when the file is served). The game starts too.
- Check: `window.sfx.state`, `window.sfx["musicStarted"]`, `#overlay[hidden]`
- Source: b56ee5c
- Automated: no

### LS-019 Audio recovers after an interruption on iPhone
- Platforms: phone portrait (WebKit, iPhone)
- State: running
- Steps:
  1. Start a run with a tap so audio is running.
  2. Suspend it with `window.sfx["ctx"].suspend()` (a screen lock or a call).
  3. Dispatch `visibilitychange` on `document`. Check the state.
  4. Suspend again, then tap the screen once.
- Expected: After step 3 and after step 4 `window.sfx.state` is "running" again.
- Check: `window.sfx.state`
- Source: b56ee5c
- Automated: no

### LS-020 Audio resumes after a tab switch or laptop sleep (desktop)
- Platforms: desktop
- State: running
- Steps:
  1. Start a run with a click.
  2. Suspend the context, dispatch `visibilitychange` on `document`.
  3. Suspend again, dispatch `focus` on `window`.
  4. Suspend again, dispatch `pageshow` on `window`.
- Expected: After each step `window.sfx.state` returns to "running" within 300 ms.
- Check: `window.sfx.state`
- Source: 03502ea
- Automated: no

### LS-021 The Sound icon switches effects only
- Platforms: desktop | phone portrait
- State: running
- Steps:
  1. Start a run, then click `.audioctl [data-k="sound"]`.
- Expected: `window.sfx.muted` becomes true, `window.sfx.musicOn` stays true, the button's
  `aria-pressed` is "false" and its label reads "Sound off". `localStorage["lights-out:muted"]` is "1".
  The click does not change the lane or start anything (`window.game().lane` unchanged).
- Check: `window.sfx.muted`, `window.sfx.musicOn`, `aria-pressed`, localStorage, `window.game().lane`
- Source: 437c259
- Automated: no

### LS-022 The Music icon switches music only
- Platforms: desktop | phone portrait
- State: running
- Steps:
  1. Start a run, then click `.audioctl [data-k="music"]`.
- Expected: `window.sfx.musicOn` becomes false, `window.sfx.muted` stays false, the label reads "Music
  off" and `localStorage["lights-out:music"]` is "0".
- Check: `window.sfx.musicOn`, `window.sfx.muted`, `aria-label`, localStorage
- Source: 437c259
- Automated: no

### LS-023 Sound and music choices are remembered across pages and reloads
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. On `/`, turn Sound off and Music off with the corner icons.
  2. Reload `/`, then open `/race.html` and `/watch.html`.
- Expected: On every page both icons show "off" (`aria-pressed="false"`), `window.sfx.muted` is true and
  `window.sfx.musicOn` is false on `/`.
- Check: `.audioctl button[aria-pressed]`, `window.sfx`
- Source: design
- Automated: no

### LS-024 M is a master mute on desktop
- Platforms: desktop
- State: running
- Steps:
  1. With both on, start a run and press M.
  2. Press M again.
  3. Turn only Music off with its icon, then press M.
- Expected: After step 1 both are off. After step 2 both are on. After step 3 (one still on) both are
  off. The icons follow each change.
- Check: `window.sfx.muted`, `window.sfx.musicOn`, `aria-pressed`
- Source: 437c259
- Automated: no

### LS-025 Tapping a corner icon during a run does not count as a swipe or a start
- Platforms: phone portrait
- State: running / game over
- Steps:
  1. Start a run, record `window.game().lane`, tap the Sound icon.
  2. After the run ends and the card shows, tap the Music icon.
- Expected: After step 1 the lane is unchanged and the run continues. After step 2 the card stays up and
  no new run starts (`window.game().dead` still true).
- Check: `window.game().lane`, `window.game().dead`, `#overlay`
- Source: 437c259
- Automated: no

### LS-026 Game events play their sounds
- Platforms: desktop
- State: running
- Steps:
  1. Start a run on `/?seed=7` with a click (audio unlocked).
  2. Press ↑, wait for landing, press ↓, steer until a coin is taken, then let a stumble and a death
     happen (or force them through `window.game()` fields).
- Expected: `window.sfx.played` has counts above 0 for "jump", "roll", "coin", "stumble", and "crash" or
  "caught" for the death. While the chaser is near, "heartbeat" counts rise. Taking a power-up raises
  "powerup", and losing a shield to a hit raises "shield".
- Check: `window.sfx.played`
- Source: 2843a82
- Automated: no

### LS-027 Unverified: the music loop has no audible gap
- Platforms: desktop
- State: running
- Steps:
  1. Play for longer than one loop of `public/audio/music.mp3`.
- Expected: The loop runs from the first to the last non-silent sample with no gap. A test can only
  check the trimmed loop points; listening is manual.
- Check: Unverified: no hook exposes the buffer source's `loopStart`/`loopEnd`; manual check
- Source: 437c259
- Automated: no

### LS-028 Music plays on the live site
- Platforms: desktop | phone portrait
- State: running
- Steps:
  1. Open `https://surfer.theonlygoatsan.com/`, click Run.
- Expected: `window.sfx["musicStarted"]` is true within 2 seconds and `/audio/music.mp3` was served with
  an audio content type (not the HTML fallback).
- Check: `window.sfx["musicStarted"]`, response headers of `/audio/music.mp3`
- Source: e165019
- Automated: no

---

## 4. Playing: controls

### LS-029 Arrow keys and A/D change lanes
- Platforms: desktop
- State: running
- Steps:
  1. Start a run on `/?seed=7` (lane 1).
  2. Press ArrowLeft, wait 300 ms; press ArrowRight twice, wait 300 ms each; press "a"; press "d".
- Expected: `window.game().lane` goes 0, 1, 2, 1, 2.
- Check: `window.game().lane`
- Source: design
- Automated: no

### LS-030 Lane changes stop at the edges
- Platforms: desktop | phone portrait
- State: running
- Steps:
  1. Start a run, press ArrowLeft three times.
- Expected: `window.game().lane` is 0 and stays 0; no error.
- Check: `window.game().lane`
- Source: design
- Automated: no

### LS-031 Up arrow or W jumps
- Platforms: desktop
- State: running
- Steps:
  1. Start a run, wait until `window.game().grounded` is true, press ArrowUp.
  2. After landing, press "w".
- Expected: Within 150 ms of each press `window.game().grounded` is false and `y` is above 0; the runner
  lands within about 0.8 seconds.
- Check: `window.game().grounded`, `window.game().y`
- Source: design
- Automated: no

### LS-032 Down arrow or S rolls for a fixed time
- Platforms: desktop
- State: running
- Steps:
  1. Start a run, press ArrowDown while grounded.
  2. Hold ArrowDown (key auto-repeat) for 2 seconds.
- Expected: `window.game().rolling` is true right after the press and false again after about 0.6
  seconds. Holding the key does not keep the runner rolling: it rolls once and stands up.
- Check: `window.game().rolling`
- Source: 98af981
- Automated: no

### LS-033 A held key is one move, not many
- Platforms: desktop
- State: running
- Steps:
  1. Start a run in lane 1, press ArrowRight once (lane 2).
  2. Hold ArrowLeft down for 1 second (so the browser sends repeat events).
- Expected: The lane changes once, from 2 to 1, and does not continue to 0.
- Check: `window.game().lane`
- Source: 98af981
- Automated: no

### LS-034 Rolling in the air drops the runner fast
- Platforms: desktop
- State: running
- Steps:
  1. Start a run, press ArrowUp, then ArrowDown 150 ms later.
- Expected: The runner lands sooner than after a plain jump and rolls on landing
  (`window.game().rolling` true right after `grounded` turns true).
- Check: `window.game().grounded`, `window.game().rolling`, time to landing
- Source: design
- Automated: no

### LS-035 Swipes steer on a phone
- Platforms: phone portrait | phone landscape
- State: running
- Steps:
  1. Tap `#play`, then on the canvas send a swipe left (pointerdown, pointerup 120 px left), a swipe
     right, a swipe up and a swipe down, each within 600 ms.
- Expected: Left changes the lane down by one, right back up, up makes `grounded` false, down makes
  `rolling` true (or drops the runner if still in the air).
- Check: `window.game().lane`, `grounded`, `rolling`
- Source: design
- Automated: no

### LS-036 A short tap or a slow drag during a run does nothing
- Platforms: phone portrait
- State: running
- Steps:
  1. During a run, tap the middle of the canvas (movement under 24 px).
  2. Drag 120 px left but take longer than 600 ms.
- Expected: The lane, `grounded` and `rolling` do not change and the run continues.
- Check: `window.game().lane`, `grounded`, `rolling`, `dead`
- Source: design
- Automated: no

### LS-037 Inputs from before the run do not leak into it
- Platforms: desktop
- State: start → running
- Steps:
  1. On the start card (name field not focused) press ArrowLeft twice.
  2. Click `#play`.
- Expected: The run starts in lane 1; the queued presses were cleared.
- Check: `window.game().lane` right after start
- Source: design
- Automated: no

---

## 5. Playing: the run, HUD, power-ups and the chaser

### LS-038 The HUD shows score, distance and coins
- Platforms: desktop | phone landscape | phone portrait
- State: running
- Steps:
  1. Start a run and play 5 seconds.
- Expected: `[data-score]` equals `window.game().score`, `[data-meters]` reads "<meters> m" and
  `[data-coins]` equals `window.game().coins`. The score is metres plus coin points and only rises.
- Check: `[data-score]`, `[data-meters]`, `[data-coins]`, `window.game()`
- Source: aa57e29
- Automated: no

### LS-039 The track number shows only with ?debug
- Platforms: desktop
- State: running
- Steps:
  1. Open `/?seed=7` and start; then open `/?seed=7&debug` and start.
- Expected: Without `?debug` the `.debug` elements are hidden. With it `[data-seed]` is visible and reads
  "track 7".
- Check: `[data-seed]` visibility and text
- Source: aa57e29
- Automated: no

### LS-040 ?seed gives the same track every time
- Platforms: desktop
- State: running
- Steps:
  1. Open `/?seed=7`, start, record `window.game().obstacles` positions; reload and repeat.
- Expected: `window.game().seed` is 7 both times and the first obstacles are identical.
- Check: `window.game().seed`, `window.game().obstacles`
- Source: design
- Automated: no

### LS-041 Coins are collected and counted
- Platforms: desktop
- State: running
- Steps:
  1. Start a run on `/?seed=7` and steer into the lane of the next coin (from `window.game().pickups`).
- Expected: `window.game().coins` and `[data-coins]` rise; the score rises by the coin's points. A taken
  coin is no longer drawn behind the runner.
- Check: `window.game().coins`, `[data-coins]`, `pickups[i].taken`
- Source: fb2a168
- Automated: no

### LS-042 Each power-up shows its badge with a draining ring
- Platforms: desktop | phone portrait
- State: running
- Steps:
  1. Start a run, then set `magnetTicks`, `springTicks`, `doubleTicks` to 600 and `shieldTicks` to 1800
     on `window.game()`.
- Expected: `[data-boosters]` shows four visible `.booster` elements named "Magnet", "Spring shoes",
  "Shield" and "x2 coins". Each ring's `--p` value falls over time. In the last 2 seconds of a
  power-up its badge has the class `ending`. When a power-up runs out its badge is hidden.
- Check: `.booster:not([hidden]) span` texts, `--p` style, `.booster.ending`
- Source: aa57e29
- Automated: no

### LS-043 The magnet pulls in coins from nearby
- Platforms: desktop
- State: running
- Steps:
  1. Start a run, set `magnetTicks = 600`, stay in one lane for 5 seconds.
- Expected: Coins in other lanes ahead are collected too (`coins` rises faster than without the magnet on
  the same seed).
- Check: `window.game().coins` with and without the magnet on the same seed
- Source: design
- Automated: no

### LS-044 Spring shoes make jumps higher
- Platforms: desktop
- State: running
- Steps:
  1. Jump once without power-ups and record the highest `y`; set `springTicks = 600` and jump again.
- Expected: The highest `y` with spring shoes is clearly higher than without.
- Check: max of `window.game().y` per jump
- Source: design
- Automated: no

### LS-045 x2 coins doubles coin points
- Platforms: desktop
- State: running
- Steps:
  1. Set `doubleTicks = 600`, collect one coin, compare the score change with a coin taken without it.
- Expected: The score rises twice as much per coin while x2 is active.
- Check: `window.game().score` change per coin
- Source: design
- Automated: no

### LS-046 A shield absorbs one hit
- Platforms: desktop
- State: running
- Steps:
  1. Set `shieldTicks = 1800`, then push a standing train right ahead in the runner's lane (as in
     `test/tools/endscene.mjs`).
- Expected: The runner does not die: `dead` stays false, `shieldTicks` drops to 0, `stumbleCount` does
  not rise, and the Shield badge disappears. A second hit after that is a normal hit.
- Check: `window.game().dead`, `shieldTicks`, `stumbleCount`, Shield `.booster` hidden
- Source: design
- Automated: no

### LS-047 Hitting a barrier is a stumble, not the end
- Platforms: desktop | phone portrait
- State: running
- Steps:
  1. Run on `/?seed=7` with no input until the first stumble (`stumbleCount` becomes 1).
- Expected: `dead` is false, `slowTicks` is above 0 (the runner slows for about 1 second), `chaserTicks`
  is above 0, and the runner stays visible (it does not blink out).
- Check: `window.game().stumbleCount`, `dead`, `slowTicks`, `chaserTicks`
- Source: fb2a168
- Automated: no

### LS-048 Changing lanes into the side of a train bounces the runner back
- Platforms: desktop
- State: running
- Steps:
  1. Put a train in the lane next to the runner, level with it, and press the arrow toward it.
- Expected: The runner ends in its original lane, `stumbleCount` rises by 1 and the run continues.
- Check: `window.game().lane`, `stumbleCount`, `dead`
- Source: design
- Automated: no

### LS-049 The chaser warning shows after a stumble
- Platforms: desktop | phone portrait
- State: running
- Steps:
  1. Run until the first stumble.
- Expected: `[data-chaser]` is visible and `[data-pips]` reads "●○" (one of two stumbles used). The
  `[data-danger]` edge glow has an opacity above 0. When `chaserTicks` reaches 0 the icon hides again.
- Check: `[data-chaser]`, `[data-pips]`, `[data-danger]` computed opacity
- Source: fb2a168
- Automated: no

### LS-050 A second stumble while the ghost is close ends the run
- Platforms: desktop | phone portrait
- State: running → game over
- Steps:
  1. Run on `/?seed=7` with no input until the run ends (as `test/tools/chase.mjs` does).
- Expected: `dead` is true and `deathCause` is "caught" after the second stumble inside the chase.
- Check: `window.game().dead`, `deathCause`, `stumbleCount`
- Source: 98af981
- Automated: no

### LS-051 Running head-on into a train ends the run
- Platforms: desktop
- State: running → game over
- Steps:
  1. Push a standing train right ahead in the runner's lane with no shield.
- Expected: `dead` is true and `deathCause` is "train front" (or "oncoming train" for a moving one).
- Check: `window.game().dead`, `deathCause`
- Source: design
- Automated: no

### LS-052 Jumping onto a train roof and rolling under a high barrier are safe
- Platforms: desktop
- State: running
- Steps:
  1. On `/?seed=7` use the search bot's moves or a recorded replay that runs up a ramp onto a train
     roof and rolls under a high barrier.
- Expected: The runner survives both (`dead` false, `stumbleCount` unchanged), and `y` equals the train
  height while on the roof.
- Check: `window.game().y`, `dead`, `stumbleCount`
- Source: design
- Automated: no

### LS-053 The game gets harder over time
- Platforms: desktop
- State: running
- Steps:
  1. Start a run, record `window.game().heat`, set a shield to survive, and read `heat` again after
     60 seconds.
- Expected: `heat` is higher after 60 seconds than at the start.
- Check: `window.game().heat`
- Source: 2725173
- Automated: no

---

## 6. Run end and the game-over card

### LS-054 The crash scene plays before the card
- Platforms: desktop | phone landscape | phone portrait
- State: running → game over
- Steps:
  1. Start a run and force a death (`g.dead = true; g.deathCause = "train front"`).
  2. Check `#overlay` at 1 second and at 2.2 seconds.
- Expected: At 1 second `#overlay` is still hidden (the ghost circles the runner). By 2.2 seconds it is
  visible. The HUD power-up badges and chaser icon are hidden once `dead` is true.
- Check: `#overlay[hidden]` over time, `[data-chaser]`, `.booster`
- Source: 437c259
- Automated: no

### LS-055 The game-over card shows the result
- Platforms: desktop | phone portrait
- State: game over
- Steps:
  1. End a run by a train hit; read the card. End another by being caught.
- Expected: `#title` reads "<score> points" with the run's score. `#sub` reads
  "<meters> m, <coins> coins · hit a train" for a train front and
  "<meters> m, <coins> coins · the Blackout caught you" for a catch. `#play` reads "Run again".
- Check: `#title`, `#sub`, `#play` text vs `window.game()`
- Source: design
- Automated: no

### LS-056 The game-over card is compact and can unfold the settings
- Platforms: desktop | phone portrait
- State: game over
- Steps:
  1. End a run and wait for the card.
  2. Click `#more` ("Change runner or level").
- Expected: Before the click `#overlay` has class `compact`: `#more` is visible and the picker, levels,
  level note, name field and hint are hidden; `#play`, `#race`, `#saveRow`, `#watch` and `#boardBtn`
  are visible. After the click `compact` is gone and all of them show.
- Check: `#overlay.compact`, visibility of `#picker`, `.levels`, `.level-info`, `.name`, `.hint`, `#more`
- Source: 437c259
- Automated: no

### LS-057 The crash scene stays visible above the card
- Platforms: phone portrait | desktop
- State: game over
- Steps:
  1. End a run and take a screenshot once the card is up.
- Expected: The runner and ghost are drawn above the card (the view slides up), not hidden behind it.
  Screenshot check against a baseline.
- Check: screenshot comparison
- Source: 437c259
- Automated: no

### LS-058 Run again starts a fresh run
- Platforms: desktop | phone landscape | phone portrait
- State: game over → running
- Steps:
  1. End a run and click `#play` ("Run again").
- Expected: `#overlay` hides, `#saveRow` hides, and `window.game()` is a new game: `tick` restarted
  from 0, `dead` false, score 0, coins 0, `stumbleCount` 0.
- Check: `#overlay[hidden]`, `#saveRow[hidden]`, `window.game()`
- Source: design
- Automated: no

### LS-059 Space, Enter or a tap after the card shows starts a new run
- Platforms: desktop | phone portrait
- State: game over → running
- Steps:
  1. End a run and wait until the card shows.
  2. Press Space (desktop), or tap `#play` (phone).
- Expected: A new run starts as in LS-058.
- Check: `#overlay[hidden]`, `window.game().tick`
- Source: design
- Automated: no

### LS-060 Starting a new run during the crash scene does not bring the old card back
- Platforms: desktop | phone portrait
- State: game over (crash scene) → running
- Steps:
  1. End a run and, within 1 second (before the card shows), press Space or tap the canvas.
  2. Wait 2 seconds.
- Expected: Either the key or tap is ignored until the card shows, or the new run starts and the old
  result card does not appear over it. `#overlay` must not be visible while `window.game().dead` is
  false.
- Check: `#overlay[hidden]` while `window.game().dead === false`
- Source: design (see the report: the current code shows the card over the new run)
- Automated: no

### LS-061 Changing the level on the game-over card applies to the next run
- Platforms: desktop | phone portrait
- State: game over → running
- Steps:
  1. Play at Normal, end the run, click `#more`, click `[data-level="0"]`, click `#play`.
- Expected: The new run has `options.level === 0`.
- Check: `window.game().options.level`
- Source: design
- Automated: no

---

## 7. Save score and sign-in

The API origin is mocked in these stories with `page.route` (see `test/tools/save-flow.mjs` and
`test/tools/pending-rescue.mjs`). The real flow is covered once by LS-075.

### LS-062 Save score shows only after a solo run
- Platforms: desktop | phone portrait
- State: start / game over
- Steps:
  1. Open `/`; check `#saveRow`. End a run; check again. Click `#play`; check again.
- Expected: Hidden on the start card, visible on the game-over card with `#save` enabled and reading
  "Save score" and `#saveMsg` empty, hidden again once the next run starts.
- Check: `#saveRow[hidden]`, `#save` text and `disabled`, `#saveMsg`
- Source: 12553ff
- Automated: no

### LS-063 Saving without a name asks for one
- Platforms: desktop | phone portrait
- State: game over
- Steps:
  1. Clear `#name`, end a run, click `#save`.
- Expected: No request is sent. `#overlay` loses `compact` so the name field shows, `#name` is focused and
  `#saveMsg` reads "Type your name first, so the board can show it."
- Check: request log, `#overlay.compact`, `document.activeElement.id === "name"`, `#saveMsg`
- Source: 12553ff
- Automated: no

### LS-064 Saving while signed in saves at once
- Platforms: desktop | phone portrait
- State: game over (signed in)
- Steps:
  1. Mock `POST /api/surfer/score` to return 200 `{score:321, level:1, best:321, rank:4, improved:true}`.
  2. Set a name, end a run on Normal, click `#save`.
- Expected: While waiting `#save` reads "Saving…" and is disabled. Then `#saveMsg` reads "Saved! Your
  best is now 321, number 4 on the Normal board." and `#save` reads "Saved" and stays disabled. The
  request body has `name` and a `replay` with `options.level` 1; it has no score field.
- Check: `#save`, `#saveMsg`, request body
- Source: 12553ff
- Automated: no

### LS-065 A lower score says the best is unchanged
- Platforms: desktop
- State: game over (signed in)
- Steps:
  1. Mock the save to return `{score:50, level:2, best:900, rank:12, improved:false}` and click `#save`.
- Expected: `#saveMsg` reads "Saved. Your best is still 900, number 12 on the Hard board."
- Check: `#saveMsg`
- Source: 12553ff
- Automated: no

### LS-066 Saving while signed out goes to sign-in and keeps the run
- Platforms: desktop | phone portrait
- State: game over (signed out)
- Steps:
  1. Mock the save to return 401. Set a name "Tester", end a run, click `#save`.
- Expected: `#saveMsg` reads "Taking you to sign in. Your run will be saved when you come back."
  `localStorage["lights-out:pending-score"]` holds `{ name: "Tester", replay, at }`. The browser goes to
  `<API>/auth/signin?return=<encoded URL of this page with ?save=pending>`; the return URL has the
  same origin and path as the game page.
- Check: `#saveMsg`, localStorage, the sign-in request URL and its `return` parameter
- Source: 12553ff
- Automated: no

### LS-067 After signing in the player comes back to the game page and the score is saved
- Platforms: desktop | phone portrait
- State: game over → sign-in → start (back)
- Steps:
  1. As in LS-066, but the mocked `/auth/signin` marks the user signed in and redirects to its `return`
     parameter, and the save then returns 200.
- Expected: The browser lands back on the game page (same origin, path `/`), not on the main site's home
  page. The `?save=pending` query is removed from the address bar. `#toast` shows "Saving your last
  run…" and then "Saved! Your best is now …". `localStorage["lights-out:pending-score"]` is removed.
  The toast hides after about 6 seconds. Exactly two score POSTs were made (the 401 and the success).
- Check: `page.url()`, `#toast` text and `hidden`, localStorage, request count
- Source: c8bf717, personal-site bd84ee9 (user-found: sign-in landed on the home page and the score was lost)
- Automated: no

### LS-068 The main site's sign-in route returns to the page given in return= or returnTo=
- Platforms: desktop
- State: sign-in
- Steps:
  1. Against the personal site (dev or staging), request
     `/auth/signin?return=https://surfer.theonlygoatsan.com/?save=pending` without following redirects.
  2. Repeat with `returnTo=` instead of `return=`.
- Expected: Both redirect to the sign-in provider with a return target that goes through
  `/auth/return?to=` and ends at `https://surfer.theonlygoatsan.com/?save=pending`, not at `/`.
- Check: `Location` header chain
- Source: personal-site bd84ee9 (user-found)
- Automated: no

### LS-069 A waiting run saves on any later page load
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. Put a pending run (less than a day old) in `localStorage["lights-out:pending-score"]`, signed in.
  2. Open `/` with no query string.
- Expected: `#toast` shows the saved message and the pending entry is removed, even though the URL had no
  `?save=pending` (a sign-in that lost its way back).
- Check: `#toast`, localStorage
- Source: c8bf717
- Automated: no

### LS-070 A waiting run while still signed out offers a Sign in button and does not redirect
- Platforms: desktop | phone portrait
- State: start
- Steps:
  1. Put a pending run in storage, mock the save to return 401, open `/`.
  2. Click `.toast-btn`.
- Expected: The page stays on `/` (no automatic redirect). `#toast` reads "Sign in to save your last
  run." with a `.toast-btn` "Sign in" button. The pending run is kept. Clicking the button goes to the
  sign-in URL as in LS-066.
- Check: `page.url()`, `#toast`, `.toast-btn`, localStorage
- Source: c8bf717
- Automated: no

### LS-071 A rejected waiting run is dropped with the reason
- Platforms: desktop
- State: start
- Steps:
  1. Put a pending run in storage and mock the save to return 400
     `{error:"Use a name of 1 to 20 letters, numbers or spaces."}`.
  2. Open `/`.
- Expected: `#toast` shows that message, the pending run is removed, and the toast hides after about 6
  seconds.
- Check: `#toast`, localStorage
- Source: c8bf717
- Automated: no

### LS-072 A waiting run is kept when the scoreboard can't be reached
- Platforms: desktop
- State: start
- Steps:
  1. Put a pending run in storage and make the API request fail (`route.abort()`). Open `/`.
- Expected: `#toast` reads "The scoreboard can't be reached right now. Please try again." and the pending
  run stays in storage for the next load.
- Check: `#toast`, localStorage
- Source: c8bf717
- Automated: no

### LS-073 A waiting run older than a day is dropped silently
- Platforms: desktop
- State: start
- Steps:
  1. Put a pending run with `at` 25 hours ago in storage and open `/`.
- Expected: No request is sent, `#toast` stays hidden and the entry is removed.
- Check: `#toast[hidden]`, localStorage, request log
- Source: c8bf717
- Automated: no

### LS-074 A failed save can be retried
- Platforms: desktop
- State: game over (signed in)
- Steps:
  1. Mock the save to fail with a network error, click `#save`; then mock success and click again.
- Expected: After the failure `#saveMsg` reads "The scoreboard can't be reached right now. Please try
  again.", `#save` reads "Try again" and is enabled. The second click saves (LS-064).
- Check: `#saveMsg`, `#save` text and `disabled`
- Source: 12553ff
- Automated: no

### LS-075 Live: the full save round trip on the real site
- Platforms: desktop | phone portrait
- State: game over → sign-in → back
- Steps:
  1. On `https://surfer.theonlygoatsan.com/` with a test account, play a short run, type a name, click
     Save score, sign in with the test account's email code.
- Expected: The browser returns to `https://surfer.theonlygoatsan.com/`, the toast shows the saved
  message, and the leaderboard for that level lists the name with the score.
- Check: `page.url()`, `#toast`, `#boardList`
- Source: c8bf717, personal-site bd84ee9 (user-found)
- Automated: no

### LS-076 A name the server rejects shows the server's message
- Platforms: desktop
- State: game over (signed in)
- Steps:
  1. Against the real API (dev), type the name "Ike!" (the field allows it; the server allows only
     letters, numbers and spaces), end a run and click `#save`.
- Expected: `#saveMsg` reads "Use a name of 1 to 20 letters, numbers or spaces." and `#save` reads "Try
  again".
- Check: `#saveMsg`, `#save`
- Source: design
- Automated: no

---

## 8. Leaderboard

### LS-077 The leaderboard opens on the current level
- Platforms: desktop | phone portrait
- State: start / game over
- Steps:
  1. With Hard selected, click `#boardBtn` on the start card. Repeat from the game-over card.
- Expected: `#board` is visible above the card, `[data-board="2"]` has `aria-checked="true"`, and the
  request goes to `/api/surfer/leaderboard?level=2` with credentials.
- Check: `#board`, `[data-board][aria-checked="true"]`, request URL
- Source: 12553ff
- Automated: no

### LS-078 The leaderboard lists rank, name and score, names as plain text
- Platforms: desktop | phone portrait
- State: leaderboard
- Steps:
  1. Mock the board with two rows, one named `<img src=x onerror=alert(1)>`, and `me: {best:321, rank:4}`.
- Expected: `#boardList` has two `li` rows reading rank, name and score. The odd name is shown as text and
  no `img` element exists inside `#boardList`. `#boardMe` reads "Your best here: 321, number 4."
- Check: `#boardList li`, `#boardList img` count 0, `#boardMe`
- Source: 12553ff
- Automated: no

### LS-079 Switching boards loads that level
- Platforms: desktop | phone portrait
- State: leaderboard
- Steps:
  1. Open the board, click `[data-board="0"]`, then quickly `[data-board="1"]`.
- Expected: The list shows "Loading…" while waiting, and in the end shows the Normal board only (a late
  Easy answer does not overwrite it). Exactly one tab is checked.
- Check: `#boardList` text, `[data-board][aria-checked]`
- Source: 12553ff
- Automated: no

### LS-080 An empty board invites the first score
- Platforms: desktop
- State: leaderboard
- Steps:
  1. Mock the Easy board with `top: []`, `me: null`, open it on Easy.
- Expected: `#boardList` reads "No scores on the Easy board yet. Be the first!" and `#boardMe` is empty.
- Check: `#boardList .empty`, `#boardMe`
- Source: 12553ff
- Automated: no

### LS-081 A board that can't be reached says so
- Platforms: desktop
- State: leaderboard
- Steps:
  1. Make the leaderboard request fail (abort or 500) and open the board.
- Expected: `#boardList` reads "The leaderboard can't be reached right now."
- Check: `#boardList .empty`
- Source: 12553ff
- Automated: no

### LS-082 Signed out, the board shows no personal line
- Platforms: desktop | phone portrait
- State: leaderboard (signed out)
- Steps:
  1. Mock the board with rows and `me: null`.
- Expected: The rows show and `#boardMe` is empty. No sign-in is asked for just to view the board.
- Check: `#boardMe`, `page.url()` unchanged
- Source: 12553ff
- Automated: no

### LS-083 Close returns to the card
- Platforms: desktop | phone portrait
- State: leaderboard → start / game over
- Steps:
  1. Open the board from the game-over card and click `#boardClose`.
- Expected: `#board` is hidden, the game-over card underneath is unchanged and the save state (for
  example "Saved") is kept.
- Check: `#board[hidden]`, `#overlay`, `#save` text
- Source: 12553ff
- Automated: no

### LS-084 A long board scrolls inside the card on a phone
- Platforms: phone portrait | phone landscape
- State: leaderboard
- Steps:
  1. Mock 50 rows and open the board.
- Expected: `#boardList` scrolls by itself (its height is at most half the screen) and `#boardClose` is
  visible on screen without scrolling the page.
- Check: `#boardList` `scrollHeight > clientHeight`, `#boardClose` in viewport
- Source: 12553ff
- Automated: no

---

## 9. Race the AI

### LS-085 Race the AI opens the race page with the chosen name, runner and level
- Platforms: desktop | phone portrait
- State: start → race
- Steps:
  1. On `/` pick Nova, type "Ike", pick Hard, click `#race`.
- Expected: The browser is on `/race.html`. `#youName` reads "Ike", `#youRunner` reads "Nova",
  `#aiName` reads "AI", `#aiRunner` reads "Kai" or "Nova". `window.race().you.options.level` and
  `window.race().ai.options.level` are both 2.
- Check: `page.url()`, `#youName`, `#youRunner`, `#aiName`, `#aiRunner`, `window.race()`
- Source: c997466, 492d2e8
- Automated: no

### LS-086 Without a stored name the player is called You
- Platforms: desktop
- State: race
- Steps:
  1. Clear `lights-out:name` and open `/race.html`.
- Expected: `#youName` reads "You".
- Check: `#youName`
- Source: design
- Automated: no

### LS-087 The start level sets the AI's difficulty
- Platforms: desktop
- State: race
- Steps:
  1. For each level 0, 1, 2: set `lights-out:level`, open `/race.html?seed=4242`, play 25 seconds with
     no player input (as `test/tools/race-ai.mjs`).
- Expected: `window.race().driver` is the trained model's label, not "stand-in bot", in production
  builds. Both games share the level. Over a fixed set of seeds the AI survives longer on Hard than on
  Easy (the level's handicap). The page never names the level next to the AI; it says just "AI".
- Check: `window.race().driver`, `window.race().ai.options.level`, `ai.meters`, `#aiName` text "AI"
- Source: 9852a7c, 492d2e8 (user decision: the level sets the AI and the opponent is called just "AI")
- Automated: no

### LS-088 The race starts with a 3-2-1 countdown
- Platforms: desktop | phone portrait
- State: race (count)
- Steps:
  1. Open `/race.html` and watch `#count`.
- Expected: `#count` shows "3", "2", "1", then "GO", then hides. `window.race().phase` is "count" during
  the countdown and "race" from GO. Neither game's tick moves before GO.
- Check: `#count` text and `hidden`, `window.race().phase`, `you.tick`, `ai.tick`
- Source: c997466
- Automated: no

### LS-089 Both runs move on the same track at the same time
- Platforms: desktop | phone portrait
- State: race
- Steps:
  1. Open `/race.html?seed=4242`, wait for GO plus 5 seconds.
- Expected: `you.seed === ai.seed`, `ai.tick` is within a few ticks of `window.race().clock`, and
  `#youScore`/`#aiScore` match the games' scores.
- Check: `window.race()`, `#youScore`, `#aiScore`
- Source: 35622d7
- Automated: no

### LS-090 Desktop and phone landscape show the race side by side; phone portrait stacks it
- Platforms: desktop | phone landscape | phone portrait
- State: race
- Steps:
  1. Open `/race.html` at 1280x720, at a phone landscape size and at 390x844.
- Expected: Wide screens: `#youHalf` on the left and `#aiHalf` on the right, each half the width.
  Portrait: `#aiHalf` on top and `#youHalf` below, each half the height. Both canvases fill their half.
- Check: bounding boxes of `#youHalf`, `#aiHalf`, their canvases
- Source: c997466
- Automated: no

### LS-091 Keys steer the player anywhere; swipes only on the player's half
- Platforms: desktop | phone portrait
- State: race
- Steps:
  1. Desktop: after GO press ArrowLeft.
  2. Phone portrait: after GO swipe left on `#aiHalf`, then swipe left on `#youHalf`.
- Expected: Step 1 moves `you.lane` to 0 and does not change `ai`. In step 2 the swipe on the AI half
  changes nothing; the swipe on your half moves `you.lane` by one.
- Check: `window.race().you.lane`
- Source: c997466
- Automated: no

### LS-092 Your crash shows on your half while the AI keeps running
- Platforms: desktop | phone portrait
- State: race
- Steps:
  1. After GO force `you.dead = true; you.deathCause = "train front"` while the AI's score is lower.
- Expected: `#youOut` shows "crashed" (or "caught by the Blackout" for a catch), `#aiOut` stays hidden,
  the AI keeps running and `phase` stays "race" until the result can no longer change.
- Check: `#youOut`, `#aiOut`, `window.race().phase`, `ai.tick`
- Source: c997466
- Automated: no

### LS-093 The result shows as soon as the winner is certain
- Platforms: desktop | phone portrait
- State: race → done
- Steps:
  1. Case A: you die with a lower score than the AI's. Case B: the AI dies with a lower score than yours
     while you are alive. Case C: both die with equal scores.
- Expected: `phase` becomes "done" and after about 1.9 seconds `#overlay` shows. `#title` reads "The AI
  wins" (A), "You beat the AI!" (B) or "A tie with the AI" (C). `#sub` reads "You scored <you> and the
  AI scored <ai>." In case B your run stops at that moment.
- Check: `window.race().phase`, `#overlay`, `#title`, `#sub`
- Source: c997466, 492d2e8
- Automated: no

### LS-094 Race again restarts on a new track
- Platforms: desktop | phone portrait
- State: done → count
- Steps:
  1. Finish a race (without `?seed`), click `#again`.
- Expected: `#overlay`, `#youOut` and `#aiOut` hide, a new countdown runs, both games restart from tick
  0, and the new seed differs from the last one.
- Check: `#overlay[hidden]`, `#count`, `window.race().you.tick`, seed
- Source: c997466
- Automated: no

### LS-095 Back leaves the race for the start page
- Platforms: desktop | phone portrait
- State: done
- Steps:
  1. Finish a race and click `#back`.
- Expected: The browser is on `/` with the start card showing and the same name, runner and level.
- Check: `page.url()`, `#overlay`, `#name`, `#charName`, `[data-level][aria-checked]`
- Source: c997466
- Automated: no

### LS-096 Race results are not saved to the leaderboard
- Platforms: desktop
- State: done
- Steps:
  1. Finish a race.
- Expected: The race result card has no Save score button and no score request is sent.
- Check: no `#save` on `/race.html`, request log
- Source: 12553ff
- Automated: no

### LS-097 Without the model files the race uses the stand-in bot
- Platforms: desktop
- State: race
- Steps:
  1. Mock `/models/policy-hard.json` and `/models/policy.json` to 404 and open `/race.html`.
- Expected: The race runs with `window.race().driver === "stand-in bot"`. A console warning is fine; no
  page error.
- Check: `window.race().driver`, `window.race().phase`
- Source: c997466
- Automated: no

### LS-098 Race sound follows the player's run
- Platforms: desktop
- State: race
- Steps:
  1. Click once (to unlock audio) during the countdown, then jump after GO.
- Expected: Unverified: `window.sfx` is not exposed on the race page, so a test can only check that
  `.audioctl` works (LS-016, LS-023). Sounds follow your run, not the AI's.
- Check: Unverified: needs a `window.sfx` hook on race.html
- Source: design
- Automated: no

---

## 10. Watch the AI

### LS-099 Watch the AI opens at the chosen level
- Platforms: desktop | phone portrait
- State: start → watching
- Steps:
  1. On `/` pick Easy and click `#watch`.
- Expected: The browser is on `/watch.html?level=0`, `#level` shows "Easy", and within 4 seconds
  `window.watch().game.tick` is rising with `game.options.level === 0`. `window.watch().driver` is the
  model label in production builds.
- Check: `page.url()`, `#level` value, `window.watch()`
- Source: 03502ea
- Automated: no

### LS-100 Watch without a level opens on Hard
- Platforms: desktop
- State: watching
- Steps:
  1. Open `/watch.html` with no query.
- Expected: `#level` value is "2" and the game runs at level 2.
- Check: `#level`, `window.watch().game.options.level`
- Source: design
- Automated: no

### LS-101 The panel shows the run number and the best score
- Platforms: desktop | phone portrait
- State: watching
- Steps:
  1. Open `/watch.html?level=0`, then force a death (`window.watch().game.dead = true`).
- Expected: `#run` reads "1" at first. After the death `#best` shows the run's score, and about 3.5
  seconds later a new run starts on its own and `#run` reads "2".
- Check: `#run`, `#best`, `window.watch().runs`
- Source: 85ab5a4
- Automated: no

### LS-102 Changing the level starts a new run at that level
- Platforms: desktop | phone portrait
- State: watching
- Steps:
  1. On `/watch.html?level=0` select "Hard" in `#level`.
- Expected: A new run starts at once: `window.watch().runs` rises by one, `#run` updates and
  `game.options.level` is 2.
- Check: `#level`, `#run`, `window.watch()`
- Source: 6963cbe
- Automated: no

### LS-103 Hide, H and a tap toggle the panel
- Platforms: desktop | phone portrait
- State: watching
- Steps:
  1. Click `#hide`. 2. Click or tap the canvas. 3. Press H twice (desktop).
- Expected: After 1 `#panel` is hidden; after 2 it shows; H hides it, H again shows it. The AI keeps
  playing throughout.
- Check: `#panel[hidden]`, `window.watch().game.tick`
- Source: 03502ea
- Automated: no

### LS-104 The watch page has no player controls
- Platforms: desktop | phone portrait
- State: watching
- Steps:
  1. Press the arrow keys and swipe on the canvas.
- Expected: The AI's run is not affected (the page has no keyboard or swipe input), and the panel shows
  only Level, Run, Best, Hide, Back and the GitHub link (no move display, no AI picker).
- Check: `#panel` children, `window.watch().game` unchanged by key presses (compare with a fixed seed)
- Source: 6963cbe
- Automated: no

### LS-105 Back returns to the start page
- Platforms: desktop | phone portrait
- State: watching
- Steps:
  1. Click the panel link "Back".
- Expected: The browser is on `/` with the start card.
- Check: `page.url()` pathname "/", `#overlay`
- Source: 03502ea
- Automated: no

### LS-106 A fixed seed replays the same AI run
- Platforms: desktop
- State: watching
- Steps:
  1. Open `/watch.html?level=2&seed=1042` twice and read `game.score` after 10 seconds.
- Expected: Both runs reach the same state at the same tick (same lane, score and metres at a given tick).
- Check: `window.watch().game` at a fixed tick
- Source: 85ab5a4
- Automated: no

### LS-107 The watch panel stays clear of the sound icons on phones
- Platforms: phone portrait
- State: watching
- Steps:
  1. Open `/watch.html` at 390x844.
- Expected: `#panel` and `.audioctl` do not overlap; all panel buttons are fully on screen.
- Check: bounding boxes
- Source: 03502ea, d71d569
- Automated: no

---

## 11. Replay page

### LS-108 The replay API loads and steps a replay
- Platforms: desktop
- State: replay
- Steps:
  1. Open `/replay.html`, wait for `window.replayApi`, load a recorded replay with a label, call
     `frame(4)` until it returns true.
- Expected: `[data-label]` shows the label, the HUD score rises, and `replayApi.result()` gives the same
  score, metres and death cause as the replay was recorded with.
- Check: `window.replayApi.result()`, `[data-label]`
- Source: 029eb3c
- Automated: no

### LS-109 ?clean hides the debug labels
- Platforms: desktop
- State: replay
- Steps:
  1. Open `/replay.html?clean` and load a replay.
- Expected: `[data-seed]` and `[data-label]` are hidden.
- Check: `.debug` visibility
- Source: aa57e29
- Automated: no

### LS-110 ?src plays a replay in real time
- Platforms: desktop
- State: replay
- Steps:
  1. Serve a replay JSON and open `/replay.html?src=<its URL>`.
- Expected: The HUD score rises at real-time speed (about 60 ticks per second) until the replay ends.
- Check: `[data-score]` over time
- Source: 029eb3c
- Automated: no

### LS-111 The runner model can be chosen for a replay
- Platforms: desktop
- State: replay
- Steps:
  1. Call `replayApi.character("girl")`, then load a replay.
- Expected: No error; the frame shows Nova (screenshot check).
- Check: screenshot, no page error
- Source: 029eb3c
- Automated: no

---

## 12. Screens, resizing, tab switching and reloads

### LS-112 The canvas fills the screen on high-DPI phones
- Platforms: phone portrait | phone landscape
- State: start / running
- Steps:
  1. Open `/` with `deviceScaleFactor` 3.
- Expected: The canvas CSS size equals `innerWidth` x `innerHeight` (not a corner of the screen).
- Check: canvas `getBoundingClientRect()` vs window size
- Source: 98af981
- Automated: no

### LS-113 All three lanes are in view in portrait
- Platforms: phone portrait
- State: running
- Steps:
  1. Start a run at 390x844 and take a screenshot.
- Expected: The three lanes are fully visible and the runner is large near the bottom (screenshot
  baseline).
- Check: screenshot
- Source: 3a7f5b1
- Automated: no

### LS-114 Resizing the window resizes the game
- Platforms: desktop
- State: running
- Steps:
  1. Start a run at 1280x800, resize to 800x600, then to 390x844.
- Expected: After each resize the canvas matches the new window size, the run continues (`tick` rising,
  `dead` false) and there is no page error.
- Check: canvas size, `window.game().tick`
- Source: design
- Automated: no

### LS-115 Unverified: rotating a phone during a run keeps the run going
- Platforms: phone portrait → phone landscape
- State: running
- Steps:
  1. Start a run in portrait, change the viewport to landscape (and back).
- Expected: The canvas resizes, the run continues and the HUD stays readable. The game does not pause on
  rotation (there is no pause feature), so the runner may hit something while the phone turns.
- Check: canvas size, `window.game().dead`, `window.game().tick`
- Source: design
- Automated: no

### LS-116 Rotating the phone on the race page re-lays the halves
- Platforms: phone portrait → phone landscape
- State: race
- Steps:
  1. Open `/race.html` in portrait, then switch the viewport to landscape.
- Expected: The layout switches from stacked to side by side and both canvases resize to their halves.
- Check: bounding boxes of `#youHalf`/`#aiHalf` and canvases
- Source: c997466
- Automated: no

### LS-117 The cards fit a phone in landscape
- Platforms: phone landscape
- State: start / game over / leaderboard
- Steps:
  1. Open `/` at a landscape phone size (e.g. 844x390), check the start card; end a run, check the
     game-over card; open the leaderboard.
- Expected: Unverified: on the start card `#play` must be reachable (on screen, or by scrolling the card).
  On the game-over card `#play`, `#save` and `#race` are on screen. `#boardClose` is on screen.
- Check: bounding boxes vs viewport
- Source: design
- Automated: no

### LS-118 The power-up badges move below the HUD on narrow screens
- Platforms: phone portrait
- State: running
- Steps:
  1. At 390x844, give all four power-ups.
- Expected: `.boosters` sits below the score row (top 70 px) and does not overlap `[data-score]` or
  `[data-meters]`.
- Check: bounding boxes
- Source: aa57e29
- Automated: no

### LS-119 Unverified: switching tabs mid-run freezes the run and resumes it on return
- Platforms: desktop | phone portrait
- State: running
- Steps:
  1. Start a run, record `tick`, open another tab for 5 seconds, come back.
- Expected: The run did not advance by 5 seconds of play while hidden (animation frames stop, and on
  return at most 250 ms is caught up). The runner is alive if it was alive before. There is no pause
  screen; the run simply continues.
- Check: `window.game().tick` before and after; needs a real background tab (`context.newPage()` +
  `bringToFront()`), which headless browsers may not throttle
- Source: design
- Automated: no

### LS-120 Reloading mid-run returns to the start card with settings kept
- Platforms: desktop | phone portrait
- State: running → start
- Steps:
  1. Pick Nova, type "Ike", pick Hard, start a run, play 5 seconds, reload.
- Expected: The start card shows with Nova, "Ike" and Hard kept. `window.game().tick` is 0. No pending
  score is created and no toast shows.
- Check: `#overlay`, `#charName`, `#name`, `[data-level][aria-checked]`, `window.game().tick`, `#toast[hidden]`
- Source: design
- Automated: no

### LS-121 Reloading the race page mid-race starts a new race
- Platforms: desktop
- State: race
- Steps:
  1. Open `/race.html`, wait 5 seconds after GO, reload.
- Expected: A new countdown runs and both games start from tick 0; no page error.
- Check: `#count`, `window.race().phase`, `you.tick`
- Source: design
- Automated: no

### LS-122 The game works in a private window without storage
- Platforms: desktop
- State: start / running / game over
- Steps:
  1. Make `localStorage` throw (override `Storage.prototype.getItem/setItem` in an init script), open `/`,
     pick a level, play and end a run, click Save score signed out.
- Expected: The game runs with defaults (Kai, Normal, sound on), no page error, and the sign-in redirect
  still happens (the run just can't be kept).
- Check: no page error, `window.game()`, request to `/auth/signin`
- Source: design
- Automated: no

### LS-123 Pinch zoom and page scrolling are off
- Platforms: phone portrait | phone landscape
- State: running
- Steps:
  1. Open `/` and swipe up and down on the canvas during a run.
- Expected: The page does not scroll or bounce (`scrollY` stays 0) and the viewport meta has
  `user-scalable=no`; `html` and `body` have `touch-action: none`.
- Check: `scrollY`, viewport meta content, computed `touch-action`
- Source: design
- Automated: no

---

## 13. Links and share previews

### LS-124 The GitHub link is on the menu cards and the watch panel, never over a run
- Platforms: desktop | phone portrait
- State: start / game over / done / watching / running
- Steps:
  1. Check `.gh` on `/` (start and game over), on `/race.html` (result card) and `.gh-inline` on
     `/watch.html`; then start a run on `/`.
- Expected: The link points to `https://github.com/GOATsann/goatsan-lab/tree/main/runner`, opens in a
  new tab (`target="_blank"`, `rel="noopener noreferrer"`) and has the label "Source code on GitHub".
  During a run it is not visible.
- Check: `.gh`, `.gh-inline` attributes and visibility
- Source: e547054
- Automated: no

### LS-125 Each page has share preview tags
- Platforms: desktop
- State: start
- Steps:
  1. Read the meta tags of `/`, `/race.html` and `/watch.html`.
- Expected: Each has `og:title`, `og:description`, `og:url` for its own page, `og:image`
  `https://surfer.theonlygoatsan.com/og.png` (1200x630) and `twitter:card` "summary_large_image".
  `/og.png` and `/apple-touch-icon.png` return 200 with image content types.
- Check: meta tags, responses
- Source: 8fca0d1
- Automated: no

### LS-126 Live: the site loads fast and the AI model is served
- Platforms: desktop | phone portrait
- State: start / race
- Steps:
  1. Open `https://surfer.theonlygoatsan.com/` and `/race.html` (as `test/tools/live-phone.mjs`).
- Expected: `/` reaches `load` within 5 seconds on a normal connection. `/models/policy-hard.json` returns
  JSON, `window.race().driver` is not "stand-in bot", HTML is served with no long cache, and `.glb`
  files are served as `model/gltf-binary`.
- Check: timings, response headers, `window.race().driver`
- Source: e165019
- Automated: no
