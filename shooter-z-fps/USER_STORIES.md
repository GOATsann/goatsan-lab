# Shooter Z: user stories

This file is the complete list of user stories for the Shooter Z browser game (live at
https://shooterz.theonlygoatsan.com). It is the spec for the automated Playwright end-to-end suite, which
runs on three profiles: desktop Chromium (1600x900, mouse and keyboard), iPhone WebKit (`devices["iPhone 13"]`
and `devices["iPhone 13 landscape"]`) and Android Chromium (`devices["Pixel 7"]` and
`devices["Pixel 7 landscape"]`).

## How to use this file

- Every story has an id (`SZ-nnn`). A test names the story it covers in its title, for example
  `test("SZ-061 Leave match works by tap on iOS", ...)`. When a story gets a test, change its
  "Automated" line from `no` to the test file name.
- Every bug a user finds becomes a story here, with the fixing commit hash in "Source", before or together
  with the fix. A bug is not fixed until its story has a passing test.
- Run the whole suite after any change to the game, not only the tests near the change. Phone bugs have come
  from code that looked desktop-only (for example `exitPointerLock` on iOS, commit 73bb2ae).
- Stories describe only what the code has today. A story whose behaviour is unclear from the code starts
  with "Unverified:" and must be confirmed by hand before its test is trusted.

## Test hooks and conventions

- `window.shooterZ` is set at the start of every match (including the menu backdrop). It exposes
  `state` (`"menu" | "play" | "watch"`), `match` (`match.game.tick`, `match.game.over`, `match.game.winnerTeam`,
  `match.game.agents[i]`, `match.game.options.mode/scoreLimit`, `match.game.map.id`, `match.paused[i]`),
  `view` (`view.stage`, `view.markers`, `view.killedBy`, `view.robots`, `view.scanGhost`), `rig`
  (`rig.mode`: `"fp" | "pov" | "follow" | "free" | "overview"`, `rig.target`), `input` (`input.locked`,
  `input.sensitivity`, `input.touch`, `input.addMouse(dx, dy)`), `hud`, `tutorial` (`index`, `done`,
  `steps`), `touchPaused`, `sfx` (`muted`, `musicOn`, `effectsOn`, `musicLevel()`, `musicInfo()`) and `ai`
  (`ai.models`, `ai.avgMs()`).
- There is no `"paused"` state value. "Paused" means: `#pause` or `#rotatePause` is visible and
  `window.shooterZ.match.game.tick` does not advance over 500 ms or more. On touch play,
  `window.shooterZ.touchPaused === true` as well.
- "Ticks advance" means `match.game.tick` grows over a 500 ms wait. The core runs at 60 ticks per second.
- "AI ready" means `document.body.classList.contains("ai-wait") === false`. Wait for it before Play or Watch.
- Every story also expects no `pageerror` events and no console errors during its steps.
- URL flags for tests: `?autotest` (desktop: behave as if the mouse were locked; headless browsers cannot lock
  it), `?nofs` (phones: do not request fullscreen), `?seed=N` (fixed match seed), `?touch` / `?phone` (force
  the touch / phone layout), `?rulebots` (hand-written bots, no AI download; shows the Easy/Normal/Hard
  `[data-setting=skill]` field), `?fps` or `?debug` (`.fps` counter), `?graphics=low|normal`,
  `?start=play|tutorial|watch` (skip the menu).
- Desktop pause needs a real pointer lock. With `?autotest` the mouse counts as locked forever, so Esc,
  losing focus and hiding the tab never pause. Pause stories on desktop run without `?autotest`, lock the
  pointer with a canvas click, and release it with `document.exitPointerLock()` (Playwright's Escape key
  does not release a real lock, because the browser handles that key itself).
- Phone taps use `page.tap()` (real touch events), never `element.click()` from script. Two of the past
  iPhone bugs did not show up with scripted clicks.
- "Phone landscape" is a touch profile wider than it is tall; "phone portrait" is taller than wide. The page
  treats a device as a phone when it has a coarse pointer and no fine pointer, or `?touch`/`?phone` is set, or
  the window is narrower than 760 px at load (`document.body.classList.contains("phone")`).

---

## 1. Page load and start menu

### SZ-001 The page loads to the start menu without errors
- Platforms: desktop | phone landscape | phone portrait
- State: page load
- Steps:
  1. Open `/` (phones: `/?nofs`).
  2. Wait until AI ready (up to 90 s).
- Expected: `#menu` is visible, `window.shooterZ.state === "menu"`, the title reads "Shooter Z" with the tagline
  "Can you beat AI?", and no page errors or console errors occur.
- Check: `!document.getElementById("menu").hidden`, `window.shooterZ.state === "menu"`, `document.title`
  contains "Shooter Z".
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-002 A live AI match plays behind the menu
- Platforms: desktop | phone landscape | phone portrait
- State: start menu
- Steps:
  1. Open `/` and wait until AI ready, then wait until both AI models have loaded (up to 60 s more).
  2. Read the tick twice, 500 ms apart.
- Expected: the backdrop is a 1 vs 3 free-for-all (`match.game.options.mode === "ffa"`, 4 agents) on the
  selected map, seen from the overview camera, with the HUD hidden. Ticks advance. Once both models are here,
  the robots alternate between the Hard and Easy models.
- Check: `window.shooterZ.rig.mode === "overview"`, `getComputedStyle(document.querySelector(".hud")).display === "none"`,
  `window.shooterZ.ai.models` equals `{0:"34m",1:"28m",2:"34m",3:"28m"}`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-003 Desktop menu shows Play, Start tutorial, Watch AI vs AI and the controls card
- Platforms: desktop
- State: start menu
- Steps:
  1. Open `/?autotest` at 1600x900.
- Expected: `#play`, `#tutorial` and `#watch` are visible. The controls card lists Move (W A S D), Aim,
  Shoot, Special Move (E or right click), Jump (Space), Crouch (C, hold), Reload (R), Scores (Tab) and Pause
  (Esc). The line "V free camera for filming · H hide the HUD · M mute" is visible. The phone buttons
  (`#playTouch`, `#tutorialTouch`, `#watchPhone`) and the Touch controls field are hidden.
- Check: `isVisible("#play")`, `isVisible(".controls-card")`, `isHidden("#playTouch")`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-004 First visit suggests the tutorial
- Platforms: desktop
- State: start menu, fresh browser context (empty localStorage)
- Steps:
  1. Open `/?autotest` in a new context.
- Expected: `#firstVisit` is visible with "New here? Start with the tutorial: nine short steps, about two
  minutes." and `#menu` has the class `first`, which highlights `#tutorial`.
- Check: `isVisible("#firstVisit")`, `#menu.classList.contains("first")`.
- Source: design
- Automated: no

### SZ-005 The tutorial suggestion goes away once the tutorial is finished or skipped through
- Platforms: desktop
- State: start menu after a completed tutorial
- Steps:
  1. In a fresh context, open `/?autotest`, click `#tutorial`.
  2. Press N nine times (skips every step).
  3. Press Escape.
- Expected: `localStorage["shooter-z:tutorialDone"] === "1"`, the menu is back, `#firstVisit` is hidden and
  `#menu` does not have the class `first`. After a page reload it stays hidden.
- Check: `localStorage.getItem("shooter-z:tutorialDone")`, `isHidden("#firstVisit")`.
- Source: design
- Automated: no

### SZ-006 Source code link opens GitHub in a new tab
- Platforms: desktop | phone landscape | phone portrait
- State: start menu
- Steps:
  1. Find `a.gh` ("Source code on GitHub").
  2. Click or tap it.
- Expected: the link points to `https://github.com/GOATsann/goatsan-lab/tree/main/shooter-z-fps`, has
  `target="_blank"` and `rel="noopener noreferrer"`, and a new page opens while the game page stays on the menu.
- Check: `a.gh` attributes; `context.waitForEvent("page")`.
- Source: design
- Automated: no

### SZ-007 The music credit is shown
- Platforms: desktop | phone landscape | phone portrait
- State: start menu
- Steps:
  1. Open the menu (scroll to the bottom of the hero on phones).
- Expected: `.credit` reads `Music: "Action Trailer" by kulakovka (Pixabay)`.
- Check: `.credit` text.
- Source: design
- Automated: no

---

## 2. Menu settings

### SZ-010 Mode: 1v1, 2v2 and 1 vs 3 can be chosen and explain themselves
- Platforms: desktop | phone landscape | phone portrait
- State: start menu
- Steps:
  1. Click/tap `[data-setting=mode] [data-v=duel]`, then `team`, then `ffa`.
- Expected: only the clicked button has the class `on` and `aria-checked="true"`. `#modeNote` reads,
  in order: "You against one AI robot.", "You and an AI teammate against two AI robots. No friendly fire.",
  "Free-for-all: you against three AI robots, everyone for themselves." `localStorage["shooter-z:mode"]` holds
  the choice.
- Check: `[data-setting=mode] .on` data-v, `#modeNote` text, localStorage.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-011 The chosen mode is the mode of the match
- Platforms: desktop | phone landscape
- State: start menu -> playing
- Steps:
  1. Choose a mode, wait until AI ready, press Play (`#play` on desktop, `#playTouch` on phones).
- Expected: 1v1 has 2 agents, 2v2 and 1 vs 3 have 4 agents, and `match.game.options.mode` is `duel`, `team`
  or `ffa`.
- Check: `window.shooterZ.match.game.agents.length`, `window.shooterZ.match.game.options.mode`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-012 Map: Army training base or Spaceship
- Platforms: desktop | phone landscape | phone portrait
- State: start menu
- Steps:
  1. Click/tap `[data-setting=map] [data-v=ship]`.
  2. Click/tap `[data-setting=map] [data-v=base]`.
- Expected: the clicked map is `on`, it is stored in `shooter-z:map`, and the menu backdrop restarts on that map
  at once. A match started afterwards uses the chosen map.
- Check: `window.shooterZ.match.game.map.id === "ship"` (then `"base"`) while still on the menu.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-013 Character select: four characters with a 3D preview and their Special Move
- Platforms: desktop | phone landscape | phone portrait
- State: start menu
- Steps:
  1. Click/tap `#chars [data-c="0"]` to `[data-c="3"]` in turn.
- Expected: four buttons exist (Dash/Dash, Bulwark/Shield, Echo/Scan, Wisp/Cloak). The clicked one has
  `aria-checked="true"`. `#cpName`, `#cpMove` and `#cpDesc` show its name, Special Move and description;
  `#cpCd` reads "Cooldown N s · press E or right-click" with N = 6, 12, 15, 15. `#charCanvas` is visible and
  fits inside the viewport. The choice is stored in `shooter-z:character`.
- Check: `#cpName`, `#cpMove`, `#cpCd` text; `#chars [aria-checked=true]` data-c.
- Source: design
- Automated: no

### SZ-014 The chosen character is the one you play
- Platforms: desktop | phone landscape
- State: start menu -> playing
- Steps:
  1. Pick Echo (`data-c="2"`), press Play.
- Expected: your robot is Echo and the HUD Special Move panel names "Scan".
- Check: `window.shooterZ.match.game.agents[0].character === 2`, `.abil b` text "Scan" (desktop).
- Source: design
- Automated: no

### SZ-015 AI level: Easy or Hard, with device defaults
- Platforms: desktop | phone landscape | phone portrait
- State: start menu, fresh context
- Steps:
  1. Open the menu in a fresh context.
  2. Click/tap `[data-setting=aiLevel] [data-v=easy]`, then `hard`.
- Expected: the field shows exactly the buttons "Easy" and "Hard". Desktop starts on Hard, phones on Easy. The
  first model requested is the default level's model (`shooter-ai-34m.onnx` on desktop, `shooter-ai-28m.onnx`
  on phones). The choice is stored in `shooter-z:aiLevel`. No text on the page says "Trained AI".
- Check: `[data-setting=aiLevel] .on` text; network requests matching `/shooter-ai-(\w+)\.onnx/`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-016 The AI level decides which model plays each robot
- Platforms: desktop
- State: start menu -> playing
- Steps:
  1. Easy, 1v1: Play. 2. Hard, 1v1: Play. 3. Hard, 2v2: Play. 4. Hard, 1 vs 3: Play.
- Expected: Easy uses the 28M model for every AI robot. Hard 1v1: the opponent is 34M. Hard 2v2: your teammate
  (slot 1) is 28M, the opponents are 34M. Hard 1 vs 3: two 34M robots and the last slot 28M.
- Check: `window.shooterZ.ai.models` per case.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-017 First to: 5, 10, 15 or 20 eliminations
- Platforms: desktop | phone landscape
- State: start menu -> playing
- Steps:
  1. Click/tap `[data-setting=limit] [data-v="5"]`, press Play.
- Expected: the default is 10. The match's score limit is 5 and the HUD score line reads "First to 5". The
  choice is stored in `shooter-z:limit`.
- Check: `window.shooterZ.match.game.options.scoreLimit === 5`, `.score .lim` text.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-018 Graphics: switching reloads the page with the new level
- Platforms: desktop | phone landscape | phone portrait
- State: start menu
- Steps:
  1. Note the default: Normal on desktop, Low on touch devices.
  2. Click/tap the other `[data-setting=graphics]` button.
  3. Wait for the reload.
- Expected: the page reloads once, `localStorage["shooter-z:graphics"]` holds the new value, the button is
  `on` after the reload, and the stage uses it. Clicking the already selected button does nothing (no reload).
  `?graphics=low` in the URL overrides the stored value.
- Check: `page.waitForNavigation()`, `window.shooterZ.view.stage.graphics`.
- Source: design
- Automated: no

### SZ-019 Mouse speed slider changes the aim sensitivity
- Platforms: desktop
- State: start menu
- Steps:
  1. Set `#sens` to 2 (fill the range input and fire `input`).
  2. Start a match.
- Expected: `window.shooterZ.input.sensitivity` equals `0.0022 * 2`, the value is stored in `shooter-z:sens`,
  and the slider shows 2 after a reload. The slider is hidden on phones.
- Check: `window.shooterZ.input.sensitivity`, `localStorage.getItem("shooter-z:sens")`.
- Source: design
- Automated: no

### SZ-020 Touch Look speed slider
- Platforms: phone landscape | phone portrait
- State: start menu
- Steps:
  1. Set `#touchSens` to 2.
  2. Start touch play and drag 100 px horizontally on the right half of the screen.
- Expected: the value is stored in `shooter-z:touchSens` and restored after a reload. The yaw change from the
  same drag is about twice as large as with Look speed 1. The slider is hidden on desktop.
- Check: `localStorage.getItem("shooter-z:touchSens")`; yaw delta of `match.game.agents[0].yaw`.
- Source: design
- Automated: no

### SZ-021 Firing mode: Simple (default) or Advanced
- Platforms: phone landscape | phone portrait
- State: start menu
- Steps:
  1. Check the default, then tap `[data-setting=fireMode] [data-v=advanced]`.
- Expected: Simple is the default. The choice is stored in `shooter-z:fireMode`. The field is hidden on desktop.
- Check: `[data-setting=fireMode] .on` data-v.
- Source: design
- Automated: no

### SZ-022 Sound effects On/Off
- Platforms: desktop | phone landscape | phone portrait
- State: start menu
- Steps:
  1. Click/tap `[data-setting=effects] [data-v=off]`, reload, then set it back to on.
- Expected: `window.shooterZ.sfx.effectsOn` follows the button, the value is stored in `shooter-z:effects`, and
  it is still Off after the reload.
- Check: `window.shooterZ.sfx.effectsOn`, localStorage.
- Source: design
- Automated: no

### SZ-023 Music On/Off
- Platforms: desktop | phone landscape | phone portrait
- State: start menu
- Steps:
  1. Interact once (click anywhere), wait 3 s.
  2. Click/tap `[data-setting=music] [data-v=off]`, wait 2 s.
  3. Click/tap `[data-setting=music] [data-v=on]`, wait 2.5 s.
- Expected: the music level drops to about 0 when Off and comes back to the menu level when On. The value is
  stored in `shooter-z:music` and survives a reload.
- Check: `window.shooterZ.sfx.musicLevel()`, `localStorage.getItem("shooter-z:music")`.
- Source: design
- Automated: no

### SZ-024 Every setting is remembered across a reload
- Platforms: desktop | phone landscape
- State: start menu
- Steps:
  1. Change mode, map, character, AI level, first to, mouse speed (desktop) or look speed and firing (phone),
     sound effects and music.
  2. Reload the page.
- Expected: every control shows the changed value after the reload.
- Check: `.seg[data-setting] .on` for each setting, `#chars [aria-checked=true]`, slider values.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-025 Menu buttons work with the keyboard and expose radio roles
- Platforms: desktop
- State: start menu
- Steps:
  1. Focus `[data-setting=limit] [data-v="15"]` and press Enter.
- Expected: First to 15 is selected. Every `.seg[data-setting]` has `role="radiogroup"` and its buttons
  `role="radio"` with an `aria-checked` value. There are no `<select>` elements on the page.
- Check: `[data-setting=limit] .on` text, `document.querySelectorAll("select").length === 0`.
- Source: design
- Automated: no

### SZ-026 Corrupt stored settings fall back to safe defaults
- Platforms: desktop
- State: page load
- Steps:
  1. Set `shooter-z:mode` to `"xyz"`, `shooter-z:aiLevel` to `"medium"`, `shooter-z:character` to `"9"`.
  2. Load the page.
- Expected: the menu shows 1v1, Easy, and the first character (Dash), with no page errors.
- Check: `.on` buttons, `#cpName` text "Dash".
- Source: design
- Automated: no

---

## 3. Loading the AI

### SZ-030 Play and Watch wait for the AI model
- Platforms: desktop | phone landscape | phone portrait
- State: start menu while the model downloads
- Steps:
  1. Delay the `.onnx` responses with `page.route` (for example 5 s).
  2. Open `/`.
- Expected: while loading, `body` has the class `ai-wait`, `#aiStatus` is visible with "Loading the AI...", and
  `#play`, `#watch`, `#playTouch` and `#watchPhone` cannot be clicked (`pointer-events: none`, half opacity).
  When the model arrives, `ai-wait` is removed and `#aiStatus` is hidden.
- Check: `document.body.classList.contains("ai-wait")`, `#aiStatusText` text.
- Source: design
- Automated: no

### SZ-031 A failed AI download shows an error and Retry works
- Platforms: desktop | phone landscape
- State: start menu
- Steps:
  1. Abort requests for `/models/shooter-ai-*.onnx` with `page.route`.
  2. Open `/` and wait for the error.
  3. Remove the route and click/tap `#aiRetry`.
- Expected: after the failure `#aiStatus` has the class `error`, reads "Couldn't load the AI." and shows a
  visible `#aiRetry` button; Play and Watch stay disabled. After Retry the model loads, `ai-wait` is removed and
  Play works.
- Check: `#aiStatusText` text, `isVisible("#aiRetry")`, then `!document.body.classList.contains("ai-wait")`.
- Source: design
- Automated: no

### SZ-032 The desktop tutorial does not need the AI
- Platforms: desktop
- State: start menu while the model downloads
- Steps:
  1. Block the `.onnx` requests.
  2. Click `#tutorial`.
- Expected: the tutorial starts (`state === "play"`, `window.shooterZ.tutorial` is set) even though the AI is
  not loaded, because the training target is scripted.
- Check: `window.shooterZ.tutorial !== null`, ticks advance (with `?autotest`).
- Source: design
- Automated: no

---

## 4. Tutorial

### SZ-040 Desktop tutorial starts at step 1 of 9
- Platforms: desktop
- State: start menu -> tutorial
- Steps:
  1. Open `/?autotest&seed=2`, click `#tutorial`.
- Expected: `#menu` is hidden, `state === "play"`, the map is the army base, the mode is 1v1, and the
  tutorial card shows "Step 1 of 9", the title "Look around", the hint "Move the mouse to look left and right."
  and "N skip step · Esc pause". Nine progress dots are shown. The score line reads "Tutorial".
- Check: `window.shooterZ.tutorial.index === 0`, `.tut-card` text, `.score .lim` text "Tutorial".
- Source: design
- Automated: no

### SZ-041 Each tutorial step completes when you do it (keyboard and mouse)
- Platforms: desktop
- State: tutorial
- Steps (each step waits for `tutorial.index` to grow):
  1. Look around: `input.addMouse(120, 0)` repeatedly until yaw has turned more than 2.2 rad.
  2. Move: hold W.
  3. Jump and crouch: press Space, hold C for 300 ms.
  4. Shoot the target: aim at the still target and hold the left mouse button.
  5. Headshot: aim at its head and click.
  6. Reload: press R.
  7. Special Move: press E.
  8. Eliminate the target: keep firing at it.
  9. Now it shoots back: eliminate the training target, which now moves and fires.
- Expected: every step completes on its own (no N presses), the steps' titles appear in this order, and at
  the end `tutorial.done === true` and the card reads "Tutorial complete" with "Press Enter to play a real
  match, Esc for the menu". `localStorage["shooter-z:tutorialDone"] === "1"`.
- Check: `window.shooterZ.tutorial.index`, `.done`, `.tut-card.done` text.
- Source: design
- Automated: no

### SZ-042 The practice target stays still and in front of you until the last step
- Platforms: desktop
- State: tutorial, steps 4 to 8
- Steps:
  1. Skip to step 4 with N.
  2. Read the target's position twice, 1 s apart.
- Expected: during steps 1 to 3 the target is parked far away; during steps 4 to 8 it stands still at about
  (0, 10.5) and `match.paused[1] === true`. If it is eliminated it reappears at the same place. On step 9
  `match.paused[1] === false` and it moves.
- Check: `window.shooterZ.match.game.agents[1].x/z`, `window.shooterZ.match.paused[1]`.
- Source: design
- Automated: no

### SZ-043 N skips a tutorial step
- Platforms: desktop
- State: tutorial
- Steps:
  1. Press N.
- Expected: `tutorial.index` grows by one and the card shows the next step. After the ninth N the tutorial is
  complete and `shooter-z:tutorialDone` is stored.
- Check: `window.shooterZ.tutorial.index`.
- Source: design
- Automated: no

### SZ-044 The Special Move step names your character's move
- Platforms: desktop | phone landscape
- State: tutorial, step 7
- Steps:
  1. Pick Wisp on the menu, start the tutorial, skip to step 7.
- Expected: the title is "Special Move: Cloak" and the hint ends with Wisp's description.
- Check: `.tut-card b` text.
- Source: design
- Automated: no

### SZ-045 After the desktop tutorial, Enter starts a real match and Esc returns to the menu
- Platforms: desktop
- State: tutorial complete
- Steps:
  1. Complete or skip the tutorial.
  2. Press Enter (and in a second run, Escape instead).
- Expected: Enter starts a new match with the menu settings (`tutorial === null`, `state === "play"`, the
  opponent is AI). Escape shows the menu (`state === "menu"`).
- Check: `window.shooterZ.tutorial`, `window.shooterZ.state`.
- Source: design
- Automated: no

### SZ-046 Pausing during the tutorial stops it
- Platforms: desktop
- State: tutorial
- Steps:
  1. Start the tutorial without `?autotest`, click the canvas to lock the mouse.
  2. Call `document.exitPointerLock()`.
- Expected: `#pause` is visible, ticks stop, and the tutorial step does not change. Resume continues the same
  step.
- Check: `isVisible("#pause")`, `match.game.tick` stable, `tutorial.index` unchanged.
- Source: design
- Automated: no

### SZ-047 Touch tutorial: touch hints and a Skip step button
- Platforms: phone landscape
- State: start menu -> tutorial
- Steps:
  1. Open `/?nofs`, wait until AI ready, tap `#tutorialTouch`.
- Expected: the touch controls are shown, the card has the class `touch-tut`, the step 1 hint reads "Drag on
  the right side of the screen to look around.", and a `.tut-skip` "Skip step" button is shown instead of the
  key hints. Tapping `.tut-skip` moves to the next step.
- Check: `.tut.touch-tut` visible, `window.shooterZ.tutorial.index` after tapping `.tut-skip`.
- Source: design
- Automated: no

### SZ-048 Touch tutorial can be played start to finish by touch
- Platforms: phone landscape
- State: tutorial (touch, Advanced firing)
- Steps:
  1. Choose Advanced firing, tap `#tutorialTouch`.
  2. Drag on the right half to look; slide the left thumb to move; tap Jump then Crouch twice; aim and hold Fire;
     tap Fire on the head; tap R; tap the Special Move button; keep firing to eliminate the target twice.
- Expected: all nine steps complete without Skip, the card reads "Tutorial complete" (no key hints), and
  `#touchEnd` with "Play again" and "Menu" is visible.
- Check: `window.shooterZ.tutorial.done`, `isVisible("#touchEnd")`.
- Source: design
- Automated: no

### SZ-049 Touch tutorial hints follow the firing mode
- Platforms: phone landscape
- State: tutorial, step 4
- Steps:
  1. With Simple firing, start the touch tutorial and skip to step 4. 2. Repeat with Advanced.
- Expected: Simple reads "Put the crosshair on the robot ahead: Simple firing shoots for you." Advanced reads
  "Aim at the robot ahead and hold Fire (drag while holding it to aim)."
- Check: `.tut-card p` text.
- Source: design
- Automated: no

### SZ-050 After the touch tutorial, Play again starts a real match and Menu returns to the menu
- Platforms: phone landscape
- State: touch tutorial complete
- Steps:
  1. Skip all steps with `.tut-skip`.
  2. Tap `#againBtn` (second run: `#menuBtn`).
- Expected: Play again starts a normal match (`tutorial === null`, `state === "play"`, ticks advance). Menu
  shows the menu (`state === "menu"`).
- Check: `window.shooterZ.tutorial`, `window.shooterZ.state`.
- Source: design
- Automated: no

### SZ-051 The tutorial card fits phone screens
- Platforms: phone landscape | phone portrait
- State: tutorial
- Steps:
  1. Start the tutorial on a 390x844 and an 844x390 viewport (portrait: `?start=tutorial&autotest&phone`).
- Expected: the `.tut-card` does not overflow the viewport horizontally and does not overlap the score line.
- Check: bounding boxes of `.tut-card` and `.score`.
- Source: fix commit fe7bc36 (narrow screens: HUD and tutorial card overlapped the score)
- Automated: no

---

## 5. Playing: desktop controls

### SZ-060 Play starts a first-person match
- Platforms: desktop
- State: start menu -> playing
- Steps:
  1. Open `/?autotest&seed=3`, wait until AI ready, click `#play`.
- Expected: `#menu` is hidden, `state === "play"`, `rig.mode === "fp"`, the HUD is visible, ticks advance and
  the opponent robots are driven by the AI (`window.shooterZ.ai` is set).
- Check: `window.shooterZ.state`, `window.shooterZ.rig.mode`, tick advancing.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-061 Clicking Play locks the mouse; without a lock the game asks for a click
- Platforms: desktop
- State: playing, no `?autotest`
- Steps:
  1. Click `#play`.
  2. If the browser refused the lock, read `#clickHint`.
  3. Click the canvas.
- Expected: when the mouse is not locked, ticks do not advance and `#clickHint` reads "Click to lock the mouse
  and play". After a canvas click the lock is taken, `#clickHint` is hidden and ticks advance.
- Check: `document.pointerLockElement === document.getElementById("view")`, `#clickHint` hidden state.
- Source: design
- Automated: no

### SZ-062 W A S D and the arrow keys move the robot
- Platforms: desktop
- State: playing
- Steps:
  1. Hold W for 1 s. 2. Hold D for 1 s. 3. Hold ArrowUp for 1 s.
- Expected: the robot's position changes in each case (at most 6 m per second).
- Check: `match.game.agents[0].x/z` before and after.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-063 Mouse movement aims
- Platforms: desktop
- State: playing
- Steps:
  1. Call `window.shooterZ.input.addMouse(200, 0)` (or move the locked mouse), wait 100 ms.
- Expected: `agents[0].yaw` changes; vertical movement changes `pitch`.
- Check: `match.game.agents[0].yaw`, `.pitch`.
- Source: design
- Automated: no

### SZ-064 Left click fires; holding it keeps firing
- Platforms: desktop
- State: playing
- Steps:
  1. Hold the left mouse button on the canvas for 1 s.
- Expected: `agents[0].shots` grows by about 7 (7.5 shots per second) and `agents[0].ammo` drops by the same
  amount. A laser sound plays (when effects are on).
- Check: `match.game.agents[0].shots`, `.ammo`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-065 R reloads; firing an empty clip reloads by itself
- Platforms: desktop
- State: playing
- Steps:
  1. Fire a few shots, press R.
  2. Fire until ammo is 0, keep holding fire.
- Expected: after R, `reloadTicks > 0`, the ammo panel has the class `reloading`, and after 1.5 s ammo is 24.
  With a full clip R does nothing. With an empty clip, holding fire starts a reload, and the ammo panel has
  the class `empty` while ammo is 0.
- Check: `agents[0].reloadTicks`, `.ammo`, `.ammo.classList`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-066 Space jumps
- Platforms: desktop
- State: playing
- Steps:
  1. Press Space.
- Expected: `agents[0].grounded` becomes false and `y` rises, then lands again. Space does not scroll the page.
- Check: `match.game.agents[0].y`, `.grounded`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-067 C or Ctrl crouches while held
- Platforms: desktop
- State: playing
- Steps:
  1. Hold C for 500 ms, release. 2. Hold ControlLeft for 500 ms, release.
- Expected: `agents[0].crouch === true` while held and false after release.
- Check: `match.game.agents[0].crouch`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-068 E or right click uses the Special Move, then it cools down
- Platforms: desktop
- State: playing
- Steps:
  1. Press E. 2. After the cooldown, right-click the canvas.
- Expected: an `ability` event fires and `agents[0].abilityCooldown > 0`. The HUD Special Move panel loses
  `ready` and its small text counts down in seconds ("N s"). When the cooldown ends the panel shows "ready (E or
  right-click)" and a quiet chime plays. Right click never opens the browser context menu on the canvas.
- Check: `match.game.agents[0].abilityCooldown`, `.abil.classList.contains("ready")`, `.abil small` text.
- Source: design
- Automated: no

### SZ-069 Each character's Special Move does its own thing
- Platforms: desktop
- State: playing
- Steps:
  1. For each character (Dash, Bulwark, Echo, Wisp), start a 1v1 and press E.
- Expected: Dash: a short burst of speed in the moving direction (cooldown 6 s). Bulwark: a frontal shield for
  2 s; lasers hitting it count as blocked and the attacker's hit marker shows `blocked` (cooldown 12 s). Echo:
  a `.scanring` element appears on screen for 0.9 s, and enemies within 20 m are exposed for 1.5 s, including
  behind walls (`view.scanGhost[i]` visible) (cooldown 15 s). Wisp: near-invisible for 3 s, ended early by
  firing (cooldown 15 s). The HUD panel shows "active" while Dash, Shield or Cloak runs.
- Check: `agents[0].abilityTicks`, `.abil.active`, `document.querySelector(".scanring")`,
  `view.scanGhost[1].some(x => x.visible)`.
- Source: design
- Automated: no

### SZ-070 Tab shows the scoreboard while held
- Platforms: desktop
- State: playing
- Steps:
  1. Hold Tab for 300 ms, release.
- Expected: `.board` is shown while Tab is held with the title "Scoreboard" and the columns Robot, Elims,
  Deaths, Accuracy, Headshots; your row has the class `me`; AI robots are labelled "AI". It hides on release.
  Tab does not move focus to a menu button.
- Check: `getComputedStyle(document.querySelector(".board")).display`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-071 2v2 scoreboard groups the teams
- Platforms: desktop | phone landscape
- State: playing (2v2)
- Steps:
  1. Start a 2v2 and open the scoreboard (Tab, or end the match on a phone).
- Expected: two team rows "Blue team: N" and "Orange team: N", each followed by its two robots. The score line
  shows "Blue team N vs N Orange team".
- Check: `.board tr.team` text, `.score` text.
- Source: design
- Automated: no

### SZ-072 Friendly fire is off in 2v2
- Platforms: desktop
- State: playing (2v2)
- Steps:
  1. Place your teammate in front of you (`match.game.teleport`), hold fire at it for 1 s.
- Expected: the teammate's health does not drop.
- Check: `match.game.agents[1].health === 100`.
- Source: design
- Automated: no

### SZ-073 Keys typed into a menu input do not move the robot
- Platforms: desktop
- State: start menu
- Steps:
  1. Focus `#sens` and press W and ArrowRight.
- Expected: no `onKey` action runs; the slider value may change, nothing in the game does.
- Check: no state change; `window.shooterZ.state === "menu"`.
- Source: design
- Automated: no

---

## 6. HUD while playing

### SZ-080 Health, ammo, score, minimap and Special Move panel are shown
- Platforms: desktop | phone landscape
- State: playing
- Steps:
  1. Start a 1v1.
- Expected: `.health` shows 100 and a full bar, `.ammo` shows 24 "/ 24", `.score` shows "First to N" and both
  scores, `canvas.mini` is drawn, and (desktop only) `.abil` names the Special Move. On touch play `.abil` is
  hidden (the touch button shows it instead).
- Check: `.health b`, `.ammo b`, `.score .lim` text; `.mini` visible.
- Source: design
- Automated: no

### SZ-081 Hit markers and damage numbers; headshots look different
- Platforms: desktop
- State: playing
- Steps:
  1. Hit the opponent in the body, then in the head (aim with `input.addMouse`).
- Expected: on each hit `.hitm` gets the class `on` plus `body`, `head`, `kill` or `blocked` for 0.25 s, and a
  floating `.num` element shows the damage (20 torso, 50 head, 15 legs); a headshot number has the class `head`.
- Check: `.hitm.className`, `.num` and `.num.head` elements.
- Source: design
- Automated: no

### SZ-082 Taking damage shows a direction arc and lowers health
- Platforms: desktop | phone landscape
- State: playing
- Steps:
  1. Let the opponent hit you.
- Expected: `.dmg .arc` elements appear and fade within 1.4 s; health drops; below 35 health `.health` has the
  class `low`. Health starts coming back 5 s after the last hit.
- Check: `.dmg .arc` count, `.health.classList.contains("low")`, `agents[0].health` over time.
- Source: design
- Automated: no

### SZ-083 Kill feed and elimination message
- Platforms: desktop | phone landscape
- State: playing
- Steps:
  1. Eliminate the opponent.
- Expected: a `.feed .kf.me` row names you and the opponent ("headshot" when it was a headshot); a toast reads
  "You eliminated <name>" or "Headshot! You eliminated <name>". The feed keeps at most 5 rows and each row
  disappears after about 5.6 s. Your team's score goes up by one.
- Check: `.feed .kf` count and text, `.toast.on` text, `match.game.teamScore`.
- Source: design
- Automated: no

### SZ-084 Standing still warns, then reveals you
- Platforms: desktop
- State: playing (not the tutorial)
- Steps:
  1. Do not move or fire for 16 s (pause the opponent with `match.paused[1] = true` to stay alive).
- Expected: from 11 s the centre reads "Standing still: revealed in N" counting down; at 15 s a toast reads "You
  stood still too long: everyone can see you. Move!" In the tutorial neither appears.
- Check: `.center` text, `.toast` text.
- Source: design
- Automated: no

### SZ-085 The crosshair opens up with movement and closes when crouched
- Platforms: desktop
- State: playing
- Steps:
  1. Read `--gap` on `.cross` standing still, while running (hold W), and while crouched.
- Expected: running gives a larger gap than standing; crouching a smaller one than standing.
- Check: `getComputedStyle(document.querySelector(".cross")).getPropertyValue("--gap")`.
- Source: design
- Automated: no

### SZ-086 Minimap shows teammates always and enemies only when revealed
- Platforms: desktop
- State: playing (2v2)
- Steps:
  1. Start a 2v2 and read the minimap pixels near your teammate's projected position; hide an enemy behind a
     wall and read the minimap again; then let it fire.
- Expected: Unverified: the teammate is always a green dot; a hidden enemy is not drawn until it is hit,
  scanned, idle-revealed or fires (a fading red ping for 1 s). This is drawn on a canvas, so the test reads
  pixels or stubs `CanvasRenderingContext2D.arc`.
- Check: `canvas.mini` pixel data.
- Source: design
- Automated: no

### SZ-087 Friend-or-foe arrows over robots
- Platforms: desktop
- State: playing (2v2)
- Steps:
  1. Sample for 30 s: for each robot, whether `view.markers[i].visible` and whether it is in your line of sight.
- Expected: the teammate's green arrow is always shown; an opponent's red arrow only while it is visible to you
  or revealed (hit within 2 s, scanned, idle-revealed); never through a wall otherwise. No robot has an
  outline or x-ray material except Echo's scan silhouettes.
- Check: `window.shooterZ.view.markers[i].visible`, `match.game.world.clear(...)`.
- Source: design (41927d6: arrows only, no body outlines)
- Automated: no

---

## 7. Death, death cam and respawn

### SZ-090 Being eliminated starts the death cam
- Platforms: desktop | phone landscape
- State: playing
- Steps:
  1. Stand still against the AI (Hard) until you are eliminated.
- Expected: `agents[0].alive === false`; the camera pulls back to third person around your robot (more than
  1.5 m from the eye point); the centre reads "Eliminated by <name>" (plus "(headshot)" when it was) and
  "Respawning in N"; the HUD has the class `dead`, which hides the crosshair, hit marker, ammo and Special Move
  panel; the killer keeps its red arrow. On touch play `.touch` has the class `dead` and every button except
  Pause is dimmed.
- Check: `.center` text, `.hud.classList.contains("dead")`, `view.killedBy[0]`, `view.markers[killer].visible`.
- Source: design
- Automated: no

### SZ-091 Respawn after 2.5 s with 2 s of spawn protection
- Platforms: desktop | phone landscape
- State: dead
- Steps:
  1. Wait for the respawn.
  2. Fire once right after respawning (second run: do not fire).
- Expected: you are alive again about 150 ticks after the elimination, back in first person with 100 health
  and 24 ammo; `protectTicks` starts at 120 and falls to 0 after 2 s, or at once when you fire. No "spawn
  protection" pill or text is shown.
- Check: `agents[0].alive`, `.protectTicks`, `.health`, `.ammo`; no element containing "Spawn protection".
- Source: design (537ba41: no spawn pill)
- Automated: no

---

## 8. Pause on desktop

### SZ-100 Losing the mouse lock (Esc) pauses the match
- Platforms: desktop
- State: playing, real pointer lock (no `?autotest`)
- Steps:
  1. Click `#play`, click the canvas so the pointer is locked, wait until ticks advance.
  2. Call `document.exitPointerLock()` (what Esc does in a real browser).
- Expected: `#pause` is visible with "Paused", "Click to jump back in.", `#resume` and `#quit` ("Leave match");
  ticks stop; held keys and buttons are released. `#clickHint` stays hidden.
- Check: `isVisible("#pause")`, tick stable over 500 ms, `window.shooterZ.input.keys.size === 0`.
- Source: design
- Automated: written (test/e2e/desktop.spec.ts) but skipped: headless browsers give no pointer lock. Check by hand until it runs headed.

### SZ-101 Resume locks the mouse and plays on
- Platforms: desktop
- State: paused
- Steps:
  1. Click `#resume`.
- Expected: the pointer is locked again, `#pause` is hidden and ticks advance.
- Check: `document.pointerLockElement`, `isHidden("#pause")`, tick advancing.
- Source: design
- Automated: written (test/e2e/desktop.spec.ts) but skipped: headless browsers give no pointer lock. Check by hand until it runs headed.

### SZ-102 Leave match returns to the menu
- Platforms: desktop
- State: paused
- Steps:
  1. Click `#quit`.
- Expected: `state === "menu"`, `#menu` visible, `#pause` hidden, the backdrop match runs, and the pointer is
  not locked.
- Check: `window.shooterZ.state === "menu"`, `isHidden("#pause")`.
- Source: design
- Automated: written (test/e2e/desktop.spec.ts) but skipped: headless browsers give no pointer lock. Check by hand until it runs headed.

### SZ-103 The pause menu has no settings
- Platforms: desktop | phone landscape
- State: paused
- Steps:
  1. Open the pause menu.
- Expected: `#pause` holds only "Resume" and "Leave match". Settings can only be changed on the start menu;
  a setting changed there applies to the next match.
- Check: `#pause button` count is 2.
- Source: design
- Automated: no

### SZ-104 Esc during a running match does not jump to the menu
- Platforms: desktop
- State: playing
- Steps:
  1. With `?autotest` (no real lock), press Escape during a match that is not over.
- Expected: `state` stays `"play"`; Escape only goes to the menu when watching, after the match is over, or
  after the tutorial is complete.
- Check: `window.shooterZ.state === "play"`.
- Source: design
- Automated: no

---

## 9. Match over

### SZ-110 Reaching the score limit ends the match with Victory or Defeat
- Platforms: desktop | phone landscape
- State: playing -> match over
- Steps:
  1. Set First to 5 and play until a team reaches 5 (or set `match.game.over = true; match.game.winnerTeam = 0`
     for a quick run, and `= 1` for a loss).
- Expected: ticks stop; the scoreboard shows with the title "Victory! You beat the AI." or "Defeat. The AI wins
  this one."; the music switches to the end level; on desktop the pointer lock is released.
- Check: `match.game.over`, `.board h2` text, tick stable, `document.pointerLockElement === null`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-111 Desktop: Enter plays again, Esc goes to the menu
- Platforms: desktop
- State: match over
- Steps:
  1. End the match. Read the board hint.
  2. Press Enter (second run: Escape).
- Expected: the board reads "Press Enter to play again, Esc for the menu". Enter starts a new match with the same
  settings (`over === false`, tick restarts near 0). Escape shows the menu.
- Check: `.board .hint` text, `window.shooterZ.match.game.over`, `window.shooterZ.state`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-112 Phone: Menu works by tap after a match ends (iOS)
- Platforms: phone landscape (WebKit iPhone 13 landscape and Chromium Pixel 7 landscape)
- State: match over
- Steps:
  1. `/?nofs`, wait until AI ready, tap `#playTouch`, wait until ticks > 30.
  2. End the match (`g.over = true; g.winnerTeam = 1`), wait 400 ms.
  3. Tap `#menuBtn`.
- Expected: before the tap, `#touchEnd` is visible and the touch controls are hidden. After the tap,
  `state === "menu"` and no page error was thrown (the bug: `document.exitPointerLock` does not exist on iOS
  and threw).
- Check: `isVisible("#touchEnd")`, `.touch` display none, `window.shooterZ.state === "menu"`, no `pageerror`.
- Source: 73bb2ae
- Automated: yes (test/e2e/phone.spec.ts)

### SZ-113 Phone: Play again works by tap after a match ends (iOS)
- Platforms: phone landscape (WebKit and Chromium)
- State: match over
- Steps:
  1. As SZ-112, but tap `#againBtn`.
- Expected: a new match starts: `state === "play"`, `match.game.over === false`, ticks advance past 30,
  `#touchEnd` hidden, touch controls shown again.
- Check: `window.shooterZ.state`, `window.shooterZ.match.game.over`, tick.
- Source: 73bb2ae
- Automated: yes (test/e2e/phone.spec.ts)

### SZ-114 Touch controls step aside after the match
- Platforms: phone landscape
- State: match over
- Steps:
  1. End a touch match while holding the stick and Fire.
- Expected: `.touch` has the class `off` (display none), every held touch is released
  (`input.touch.fire === false`, `forward === 0`).
- Check: `document.querySelector(".touch").classList.contains("off")`, `window.shooterZ.input.touch`.
- Source: 73bb2ae
- Automated: yes (test/e2e/phone.spec.ts)

### SZ-115 Unverified: the phone end screen tells you to press Enter
- Platforms: phone landscape
- State: match over
- Steps:
  1. End a touch match and read `.board .hint`.
- Expected: Unverified: the board hint reads "Press Enter to play again, Esc for the menu" even on phones, where
  the `#touchEnd` buttons are the real way on. The buttons must stay visible and not covered by the board.
- Check: `.board .hint` text; bounding boxes of `#touchEnd` and `.board`.
- Source: design
- Automated: no

---

## 10. Watch AI vs AI

### SZ-120 Watch AI vs AI starts a spectator match
- Platforms: desktop | phone landscape | phone portrait
- State: start menu -> watching
- Steps:
  1. Wait until AI ready. Click `#watch` (desktop) or tap `#watchPhone` (phones).
- Expected: `state === "watch"`, `#menu` hidden, `rig.mode === "follow"`, every robot is AI with 34M against 28M,
  the HUD has the class `spectating`, ticks advance, and the robots meet and fire within 90 s.
- Check: `window.shooterZ.state === "watch"`, `window.shooterZ.ai.models`, total `shots` of all agents > 0.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-121 Spectator bar: previous and next robot
- Platforms: desktop | phone landscape | phone portrait
- State: watching
- Steps:
  1. Click/tap `[data-sb=next]`, then `[data-sb=prev]`.
- Expected: `rig.target` moves forward and back through the robots (wrapping around); `.specbar .who` shows the
  robot's name and character; from overview or free camera it switches to follow; the auto-director stops.
- Check: `window.shooterZ.rig.target`, `.specbar .who` text.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-122 Spectator bar: camera button cycles views
- Platforms: desktop | phone landscape | phone portrait
- State: watching
- Steps:
  1. Click/tap `[data-sb=cam]` four times.
- Expected: desktop cycles Follow -> Robot's eyes -> Overview -> Free camera -> Follow; phones cycle Follow ->
  Robot's eyes -> Overview -> Follow (no free camera). The button text names the current view.
- Check: `window.shooterZ.rig.mode` (`follow`, `pov`, `overview`, `free`), `[data-sb=cam]` text.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-123 Spectator bar: Menu
- Platforms: desktop | phone landscape | phone portrait
- State: watching
- Steps:
  1. Click/tap `[data-sb=menu]`.
- Expected: `state === "menu"` and `#menu` is visible.
- Check: `window.shooterZ.state === "menu"`.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-124 Spectator keys on desktop
- Platforms: desktop
- State: watching
- Steps:
  1. Press Digit2, F, P, O, V, V, A, Tab (hold), Escape.
- Expected: Digit2 targets robot 2 (index 1) in follow view; F follow; P robot's eyes; O overview; V free camera
  and V again back to follow; A turns the auto-director back on; Tab shows the scoreboard; Escape goes to the
  menu. The spectator bar shows the key list "1-4 pick a robot · F follow · P robot's eyes · O overview · V free
  camera · Tab scores · H hide HUD · Esc menu" (not on phones).
- Check: `window.shooterZ.rig.mode`, `.rig.target`, `.board` display, `window.shooterZ.state`.
- Source: design
- Automated: no

### SZ-125 The auto-director cuts to whoever made an elimination
- Platforms: desktop | phone landscape | phone portrait
- State: watching (follow or robot's eyes, auto-director on)
- Steps:
  1. Wait for a `kill` event.
- Expected: about 0.9 s after the kill `rig.target` becomes the killer; when the watched robot was the one
  eliminated, the cut waits about 2.3 s so its death cam plays first. After a manual prev/next or digit pick the
  auto-director no longer cuts.
- Check: `window.shooterZ.rig.target` before and after.
- Source: fix commit fe7bc36 (the death cam was cut off)
- Automated: no

### SZ-126 Free camera while watching
- Platforms: desktop
- State: watching, free camera
- Steps:
  1. Press V. Click the canvas (locks the mouse). Hold W, Space, C, and Shift+W; move the mouse.
- Expected: the camera flies with WASD, Space or E up, C or Q down, Shift faster, mouse look; `rig.x/y/z` change;
  the camera never goes below 0.3 m.
- Check: `window.shooterZ.rig.x/y/z/yaw`.
- Source: design
- Automated: no

### SZ-127 The next AI vs AI match starts by itself on the other map
- Platforms: desktop | phone portrait
- State: watching, match over
- Steps:
  1. End the watched match (`g.over = true; g.winnerTeam = 0`).
  2. Wait 7.5 s.
- Expected: the board title reads "<team or robot> wins" and "Next match starts in a moment"; after about 7 s a
  new match starts on the other map (`base` <-> `ship`) and `state` stays `"watch"`.
- Check: `.board h2` text, `match.game.map.id`, `match.game.over === false`.
- Source: design
- Automated: no

### SZ-128 Watch uses the selected mode and map
- Platforms: desktop
- State: start menu -> watching
- Steps:
  1. Choose 2v2 and the Spaceship, click `#watch`.
- Expected: four AI robots on the ship, team 0 on 34M and team 1 on 28M.
- Check: `match.game.options.mode === "team"`, `match.game.map.id === "ship"`, `ai.models`.
- Source: design
- Automated: no

---

## 11. Free camera, HUD and mute keys during play

### SZ-130 V toggles the free camera during play
- Platforms: desktop
- State: playing
- Steps:
  1. Press V, hold W for 500 ms, press V again.
- Expected: `rig.mode` becomes `free`, the spectator bar reads "Free camera: WASD fly, mouse look, Space/C up and
  down, Shift faster. Press V to go back to your robot.", your robot stands still (W moves the camera, not the
  robot), ticks keep advancing. The second V returns to `fp`.
- Check: `window.shooterZ.rig.mode`, `agents[0].x/z` unchanged, `.specbar` text.
- Source: design
- Automated: no

### SZ-131 H hides and shows the HUD
- Platforms: desktop
- State: playing or watching
- Steps:
  1. Press H, then H again.
- Expected: `.hud` gets `display: none`, then shows again. The choice carries over into the next match. H does
  nothing on the menu.
- Check: `document.querySelector(".hud").style.display`.
- Source: design
- Automated: no

### SZ-132 M mutes all sound
- Platforms: desktop
- State: playing or watching
- Steps:
  1. Press M, then M again.
- Expected: `window.shooterZ.sfx.muted` becomes true, then false. Unverified: M is not stored and does nothing on
  the menu.
- Check: `window.shooterZ.sfx.muted`.
- Source: design
- Automated: no

---

## 12. Phone landscape: touch play

### SZ-140 Landscape menu shows Play, Start tutorial and Watch AI vs AI
- Platforms: phone landscape
- State: start menu
- Steps:
  1. Open `/?nofs` on iPhone 13 landscape and Pixel 7 landscape.
- Expected: `#playTouch`, `#tutorialTouch` and `#watchPhone` are visible; the desktop buttons and the controls
  card are hidden; the rotate note is hidden; the touch-controls note (`.pc-note`) is visible. The menu shows
  two columns.
- Check: `isVisible("#playTouch")`, `isHidden("#play")`, `isHidden(".rotate")`.
- Source: design
- Automated: no

### SZ-141 Play by tap starts touch play
- Platforms: phone landscape
- State: start menu -> playing
- Steps:
  1. Wait until AI ready, tap `#playTouch`.
- Expected: `state === "play"`, `body` has the class `touchplay`, `.touch` is shown with Pause, Reload,
  Special Move, Jump and Crouch buttons, ticks advance. A hint `.t-hint` shows at first and fades after 5 s
  (class `gone`).
- Check: `document.body.classList.contains("touchplay")`, `.touch` visible, `.t-hint.gone` after 5.5 s.
- Source: design
- Automated: no

### SZ-142 Play requests fullscreen and a landscape lock where allowed
- Platforms: phone landscape (Android Chromium)
- State: start menu -> playing
- Steps:
  1. Open `/` without `?nofs`, tap `#playTouch`.
- Expected: on Android Chromium `document.fullscreenElement` is set. On iPhone, where fullscreen is not
  supported, the match still starts with no error. With `?nofs` no fullscreen is requested.
- Check: `document.fullscreenElement !== null` (Android), no `pageerror` (iPhone).
- Source: design
- Automated: no

### SZ-143 Unverified: there is no way to leave fullscreen inside the game
- Platforms: phone landscape
- State: start menu after a fullscreen match
- Steps:
  1. Play (fullscreen), then Leave match.
- Expected: Unverified: the page stays fullscreen on the menu; the game has no exit-fullscreen control and leaves
  that to the system gesture. A test should at least check the menu still fits and works in fullscreen.
- Check: `document.fullscreenElement`; menu buttons tappable.
- Source: design
- Automated: no

### SZ-144 The left thumb-stick moves the robot
- Platforms: phone landscape
- State: playing (touch)
- Steps:
  1. Touch down at (150, 290) and slide up 60 px; hold 500 ms.
- Expected: a stick (`.t-stick`) appears under the thumb, `input.touch.forward === 1`, the robot moves; on
  release the stick hides and movement stops. Small slides inside the dead zone do not move.
- Check: `window.shooterZ.input.touch.forward`, `.t-stick` hidden state, `agents[0].x/z`.
- Source: design
- Automated: no

### SZ-145 Dragging on the right side aims
- Platforms: phone landscape
- State: playing (touch)
- Steps:
  1. Touch down at (560, 170) and drag 80 px to the right.
- Expected: `agents[0].yaw` changes; releasing the touch stops turning.
- Check: `match.game.agents[0].yaw`.
- Source: design
- Automated: no

### SZ-146 Move, aim and Fire at the same time (multi-touch)
- Platforms: phone landscape
- State: playing (touch, Advanced firing)
- Steps:
  1. Hold the stick forward, drag on the right side, and hold `.t-fire` with a third touch for 900 ms.
- Expected: the robot moves, turns and fires in the same window (`shots` grows).
- Check: `agents[0].x/z`, `.yaw`, `.shots`.
- Source: design
- Automated: no

### SZ-147 Simple firing fires by itself when the crosshair is on a visible enemy
- Platforms: phone landscape
- State: playing (touch, Simple firing)
- Steps:
  1. With the default Simple firing, aim at a visible opponent by dragging.
- Expected: the Fire buttons are hidden (`.touch.simple .t-fire` display none); the robot fires while the
  crosshair is on a visible enemy and stops when it is not; `input.touch.fire` stays false; shots and hits grow.
- Check: `.t-fire` computed display, `agents[0].shots/hits`, `input.touch.autoFire`.
- Source: design
- Automated: no

### SZ-148 Advanced firing: Fire also aims, and a second Fire button for the left thumb
- Platforms: phone landscape
- State: playing (touch, Advanced firing)
- Steps:
  1. Hold `.t-fire:not(.t-fire-left)` and drag it; release.
  2. Hold `.t-fire-left` while dragging on the right side.
- Expected: dragging while holding Fire turns the view and fires; the left Fire fires while the right thumb
  aims; firing stops only when no Fire button is held.
- Check: `agents[0].yaw`, `.shots`, `input.touch.fire`.
- Source: design
- Automated: no

### SZ-149 Jump, Crouch (toggle) and Reload buttons
- Platforms: phone landscape
- State: playing (touch)
- Steps:
  1. Tap `.t-jump`. 2. Tap `.t-crouch`, wait, tap it again. 3. Fire a few shots, tap `.t-reload`.
- Expected: Jump makes the robot jump. Crouch stays on after the first tap (button class `latched`,
  `agents[0].crouch === true`) and turns off on the second tap. Reload starts a reload.
- Check: `agents[0].grounded`, `.crouch`, `.reloadTicks`, `.t-crouch.latched`.
- Source: design
- Automated: no

### SZ-150 Special Move button with cooldown ring
- Platforms: phone landscape
- State: playing (touch)
- Steps:
  1. Tap `.t-ability`.
- Expected: when ready the button has the class `ready` and shows the move's name; after the tap the ability
  fires (`abilityCooldown > 0`), the label counts down in seconds and the ring (`--p`) fills back up.
- Check: `.t-ability.ready`, `.t-ab-label` text, `agents[0].abilityCooldown`.
- Source: design
- Automated: no

### SZ-151 The touch hint does not cover the Crouch button
- Platforms: phone landscape
- State: playing (touch), first 5 s
- Steps:
  1. Start touch play on iPhone 13 landscape and Pixel 7 landscape; read the boxes at once.
- Expected: `.t-hint` sits under the score and does not intersect any `.t-btn`, `.health` or the crosshair.
- Check: bounding boxes of `.t-hint`, `.t-crouch`, every `.t-btn`, `.health`, `.cross`.
- Source: cb02777
- Automated: no

### SZ-152 Pause button pauses touch play; Resume plays on
- Platforms: phone landscape
- State: playing (touch)
- Steps:
  1. Tap `.t-pause`, wait 250 ms.
  2. Tap `#resume`.
- Expected: after the pause tap, `#pause` is visible, `touchPaused === true`, ticks stop, and the touch controls
  are hidden (`.touch.off`). After Resume, `#pause` is hidden, ticks advance and the controls are back.
- Check: `isVisible("#pause")`, `window.shooterZ.touchPaused`, tick, `.touch.off`.
- Source: 73bb2ae
- Automated: yes (test/e2e/phone.spec.ts)

### SZ-153 Phone: Leave match works by tap from the pause menu (iOS)
- Platforms: phone landscape (WebKit iPhone 13 landscape and Chromium Pixel 7 landscape)
- State: paused (touch)
- Steps:
  1. Tap `.t-pause`, then tap `#quit`.
- Expected: `state === "menu"` within 400 ms and no page error (WebKit has no Pointer Lock API; the old code
  called the missing `document.exitPointerLock` and threw).
- Check: `window.shooterZ.state === "menu"`, no `pageerror`.
- Source: 73bb2ae
- Automated: yes (test/e2e/phone.spec.ts)

### SZ-154 Touch play HUD fits a phone in landscape
- Platforms: phone landscape
- State: playing (touch)
- Steps:
  1. Start touch play at 844x390 and on both device profiles.
- Expected: the health panel, ammo, score, minimap and kill feed do not overlap any touch button or each other;
  no element overflows the viewport horizontally; buttons respect the safe-area insets.
- Check: bounding boxes of `.hud > *` and `.t-btn`; `document.documentElement.scrollWidth <= innerWidth`.
- Source: design
- Automated: no

### SZ-155 The page does not scroll, zoom or pull-to-refresh during touch play
- Platforms: phone landscape
- State: playing (touch)
- Steps:
  1. Swipe down from the top of the screen and pinch on the play area.
- Expected: `body.touchplay` has `touch-action: none` and is fixed; `window.scrollY` stays 0, the page does not
  reload and the zoom does not change.
- Check: `getComputedStyle(document.body).touchAction === "none"`, `scrollY`, no navigation.
- Source: design
- Automated: no

### SZ-156 Watch AI vs AI in landscape uses tappable spectator buttons
- Platforms: phone landscape
- State: watching
- Steps:
  1. Tap `#watchPhone`, then tap `[data-sb=next]`, `[data-sb=cam]`, `[data-sb=menu]`.
- Expected: each works as in SZ-121 to SZ-123; every spectator button is at least 44 px tall and wide; no key
  hints are shown.
- Check: `rig.target`, `rig.mode`, `state`, bounding boxes.
- Source: design
- Automated: no

---

## 13. Phone portrait and turning the phone

### SZ-160 Portrait menu: rotate note and Watch AI vs AI only
- Platforms: phone portrait
- State: start menu
- Steps:
  1. Open `/?nofs` on iPhone 13 and Pixel 7 (portrait).
- Expected: `.rotate` is visible with "Rotate your phone to play. Or watch the robots play each other right
  now."; `#playTouch` and `#tutorialTouch` are hidden; `#watchPhone` is visible and highlighted; `#play` is hidden.
- Check: computed display of `.rotate`, `#playTouch`, `#watchPhone`.
- Source: design
- Automated: no

### SZ-161 Watch AI vs AI works in portrait
- Platforms: phone portrait
- State: watching
- Steps:
  1. Tap `#watchPhone`, wait 6 s, tap `[data-sb=cam]`.
- Expected: `state === "watch"`, ticks advance, the camera mode changes; the camera field of view widens for the
  tall screen (85 degrees).
- Check: `window.shooterZ.state`, `rig.mode`, `window.shooterZ.view.stage.camera.fov === 85`.
- Source: design
- Automated: no

### SZ-162 Turning the phone to portrait mid-match pauses at once
- Platforms: phone landscape -> phone portrait (WebKit and Chromium)
- State: playing (touch)
- Steps:
  1. Start touch play in landscape, wait until ticks > 30.
  2. Swap the viewport to portrait (`setViewportSize({width: h, height: w})`), wait 300 ms.
  3. Read the tick, wait 700 ms, read it again.
- Expected: no ticks run (the two reads are equal); `#rotatePause` is visible with "Rotate your phone to play"
  and "The match is paused. Turn your phone sideways to continue."; `#pause` is hidden; the touch controls are
  hidden and every held touch is released.
- Check: tick equal, `isVisible("#rotatePause")`, `isHidden("#pause")`, `.touch.off`.
- Source: 73bb2ae
- Automated: yes (test/e2e/phone.spec.ts)

### SZ-163 Turning back to landscape brings back Resume
- Platforms: phone portrait -> phone landscape (WebKit and Chromium)
- State: paused by rotation
- Steps:
  1. From SZ-162, set the viewport back to landscape, wait 300 ms.
  2. Tap `#resume`, wait 500 ms.
- Expected: `#pause` is visible with Resume, `#rotatePause` hidden; the canvas size equals the new window size;
  after Resume ticks advance, `#pause` hides and the touch controls return. The match does not resume by itself.
- Check: `isVisible("#pause")`, canvas `clientWidth/clientHeight` vs `innerWidth/innerHeight`, tick.
- Source: 73bb2ae
- Automated: yes (test/e2e/phone.spec.ts)

### SZ-164 Resume does nothing while the phone is still upright
- Platforms: phone portrait
- State: paused by rotation
- Steps:
  1. While in portrait, call `document.getElementById("resume").click()` (the button is not visible).
- Expected: the match stays paused: `touchPaused === true`, ticks do not advance.
- Check: `window.shooterZ.touchPaused`, tick.
- Source: 73bb2ae
- Automated: no

### SZ-165 Leave match from the rotate screen
- Platforms: phone portrait
- State: paused by rotation
- Steps:
  1. Tap `#quitRotate`.
- Expected: `state === "menu"`, the portrait menu with the rotate note shows, no page error.
- Check: `window.shooterZ.state === "menu"`.
- Source: design (same code path as the 73bb2ae fix)
- Automated: no

### SZ-166 Turning the phone on the menu switches the layout
- Platforms: phone portrait <-> phone landscape
- State: start menu
- Steps:
  1. Open in portrait, then switch the viewport to landscape, then back.
- Expected: the Play and Start tutorial buttons appear in landscape and hide in portrait; the rotate note does the
  opposite; the canvas follows the size; no page errors.
- Check: computed display of `#playTouch`, `.rotate`.
- Source: design
- Automated: no

### SZ-167 Phone menus have 44 px tap targets, readable text and no sideways scroll
- Platforms: phone portrait | phone landscape
- State: start menu, character select, watching
- Steps:
  1. At 390x844 and 844x390 audit `#menu` and `.hud`.
- Expected: every visible button, link and input is at least 44x44 px; no text is smaller than 12 px; nothing
  overflows the viewport horizontally (`scrollWidth <= innerWidth`); the character preview canvas fits.
- Check: the audit in `test/tools/mobile-check.mjs`.
- Source: design (fe7bc36)
- Automated: no

---

## 14. Background, window size and reload

### SZ-170 The page going to the background pauses touch play
- Platforms: phone landscape (WebKit and Chromium)
- State: playing (touch)
- Steps:
  1. Make `document.hidden` return true and dispatch `visibilitychange`.
  2. Read the tick twice, 600 ms apart.
- Expected: ticks stop and `#pause` is visible with Resume. Making the page visible again does not resume by
  itself; tapping `#resume` does.
- Check: tick equal, `isVisible("#pause")`, `window.shooterZ.touchPaused`.
- Source: 73bb2ae
- Automated: yes (test/e2e/phone.spec.ts)

### SZ-171 Hiding the tab pauses desktop play
- Platforms: desktop
- State: playing, real pointer lock (no `?autotest`)
- Steps:
  1. Lock the pointer, then switch to a new tab (`context.newPage()` and `bringToFront()`), then come back.
- Expected: the pointer lock is released, `#pause` is visible, ticks do not advance; Resume continues.
- Check: `isVisible("#pause")`, tick.
- Source: 73bb2ae
- Automated: no

### SZ-172 Coming back from a hidden tab does not fast-forward the match
- Platforms: desktop
- State: watching (no pause applies when watching)
- Steps:
  1. While watching, hide the page for 5 s (new tab in front), then bring it back.
- Expected: the tick grows by at most a few frames' worth on return, not 300 ticks; robots do not jump.
- Check: `match.game.tick` before hiding and right after return.
- Source: design
- Automated: no

### SZ-173 Watching and the menu backdrop do not pause in the background
- Platforms: desktop | phone portrait
- State: watching or start menu
- Steps:
  1. Dispatch `visibilitychange` with `document.hidden === true` while watching.
- Expected: `state` stays `"watch"`; no pause overlay is shown (pause applies to play only).
- Check: `isHidden("#pause")`, `window.shooterZ.state === "watch"`.
- Source: design
- Automated: no

### SZ-174 Resizing the desktop window resizes the game
- Platforms: desktop
- State: start menu, playing, watching
- Steps:
  1. Resize the viewport from 1600x900 to 1024x700 and to 800x1000.
- Expected: the canvas follows the window size, the camera aspect matches, the field of view is 85 when the window
  is taller than wide and 72 otherwise; the HUD stays inside the viewport; play continues without pausing.
- Check: canvas `clientWidth/clientHeight`, `view.stage.camera.aspect`, `.fov`, tick advancing.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-175 Unverified: a narrow desktop window at load uses the phone layout
- Platforms: desktop
- State: page load at 700x900 with a mouse
- Steps:
  1. Open `/` with a 700 px wide viewport and no touch.
- Expected: Unverified: `body.phone` is set because the window is under 760 px, so the menu shows the phone buttons
  and Play starts touch controls on a mouse device. Widening the window later does not switch back (the layout is
  chosen once at load). Confirm whether this is wanted.
- Check: `document.body.classList.contains("phone")`, `isVisible("#playTouch")`.
- Source: design
- Automated: no

### SZ-176 Reloading the page mid-match returns to the menu with settings kept
- Platforms: desktop | phone landscape
- State: playing
- Steps:
  1. Change some settings, start a match, play 3 s, reload the page.
- Expected: the page opens on the menu (`state === "menu"`), there is no running match from before, every setting
  is as chosen, and there are no page errors. The match is not resumed (no saved match state exists).
- Check: `window.shooterZ.state === "menu"`, settings `.on` buttons.
- Source: design
- Automated: yes (test/e2e/desktop.spec.ts)

### SZ-177 Start links skip the menu
- Platforms: desktop
- State: page load
- Steps:
  1. Open `/?autotest&start=watch`, then `/?autotest&start=tutorial`, then `/?autotest&start=play`.
- Expected: start=watch waits for the AI and starts watching; start=tutorial opens the tutorial; start=play opens a
  match. On phones start=play and start=tutorial (without `?autotest`) show the menu instead.
- Check: `window.shooterZ.state`, `window.shooterZ.tutorial`.
- Source: design
- Automated: no

---

## 15. Sound and music

### SZ-180 Music starts on the first interaction and loops
- Platforms: desktop | phone landscape
- State: start menu
- Steps:
  1. Open the page; read `sfx.musicInfo()`.
  2. Click (tap) anywhere, wait 3.5 s, read it again.
- Expected: before the interaction no music plays. After it the music plays in a loop with the silent ends
  trimmed (`playing === true`, `loop === true`, `loopStart > 0`, `loopEnd < duration`), at the menu level (about
  0.30).
- Check: `window.shooterZ.sfx.musicInfo()`, `.musicLevel()`.
- Source: design
- Automated: no

### SZ-181 Music ducks during a match, lower still while firing, and comes back on the menu
- Platforms: desktop
- State: start menu -> playing -> start menu
- Steps:
  1. After an interaction, start a match, wait 3.5 s; hold fire 250 ms; release and wait 2.5 s; leave to the menu
     and wait 3.5 s.
- Expected: about 0.085 in a match, lower while firing, back to about 0.085 after, about 0.12 when watching, and
  back to the menu level on the menu and after a match ends.
- Check: `window.shooterZ.sfx.musicLevel()`.
- Source: design
- Automated: no

### SZ-182 The deployed site serves the music as audio and it plays
- Platforms: desktop (live site only)
- State: start menu
- Steps:
  1. `HEAD https://shooterz.theonlygoatsan.com/audio/music.mp3`.
  2. Open the live site, click once, wait 3.5 s.
- Expected: status 200 with `content-type: audio/mpeg`; `sfx.musicInfo().playing === true`.
- Check: response header; `window.shooterZ.sfx.musicInfo()`.
- Source: acccebc (music did not play on the deployed site: the mp3 went out as application/octet-stream)
- Automated: no

### SZ-183 Special Move sound files load
- Platforms: desktop
- State: playing
- Steps:
  1. Start a match after an interaction, wait 2.5 s.
- Expected: `sfx.samples` has the Special Move samples; with them missing the synthesized stand-ins play with no
  errors.
- Check: `[...window.shooterZ.sfx.samples.keys()]`.
- Source: design
- Automated: no

---

## 16. Deployed site and robustness

### SZ-190 The deployed files have the right types and caching
- Platforms: desktop (live site only)
- State: none (HTTP)
- Steps:
  1. HEAD `/`, the main JS asset, `/models/shooter-ai-28m.onnx`, `/models/shooter-ai-34m.onnx`, their `.json`,
     `/characters/dash.glb`, `/characters/characters.json`, `/sfx/echo.mp3` and the onnxruntime `.wasm`.
- Expected: every file answers 200 with a matching content type (`.wasm` application/wasm, `.mp3` audio/mpeg);
  hashed `assets/` files are cached for a year, fixed-name files revalidate.
- Check: `test/tools/live-check.mjs` header report.
- Source: design (e48d9f0, acccebc)
- Automated: no

### SZ-191 A full desktop match against the AI runs without errors at a playable frame rate
- Platforms: desktop
- State: playing
- Steps:
  1. `/?autotest&fps`, Play a 1v1 on Hard for 30 s with scripted aim.
- Expected: both sides fire and hit; the AI's average decision time (`ai.avgMs()`) stays under a few
  milliseconds; the `.fps` counter shows at least 30 fps on CI hardware; no console errors.
- Check: `agents[i].shots/hits`, `window.shooterZ.ai.avgMs()`, `.fps` text.
- Source: design
- Automated: no

### SZ-192 Character models load as the rigged characters
- Platforms: desktop | phone landscape
- State: start menu, playing
- Steps:
  1. Open the menu, wait 3 s; start a 1v1.
- Expected: every entry in `view.robots` is the rigged character class, not the stand-in.
- Check: `window.shooterZ.view.robots.map(r => r.constructor.name)`.
- Source: design
- Automated: no
