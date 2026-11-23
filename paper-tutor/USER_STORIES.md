# User stories

Every control and flow, in the states where it can break, with what should happen. Each automated story has a
test with the same id in `e2e/` (`npm run test:e2e`), run on desktop Chromium and iPhone WebKit (portrait, and
landscape where tagged). The tests run with the voice on, using a short local tone for every voice line and
stubbed AI answers, so a run costs nothing; they check the audio itself (muted, paused, position moving), not
just the picture.

**Rule:** after any change, run the whole suite and report the pass and fail counts. Nothing is "done" with a
failing story. Every bug found by a person gets a story here first (marked *bug*), then a test.

States used below. Playback: playing, paused, between sentences, at the end. Layout: normal, pinned (phone,
scrolled), full screen. Device: desktop, phone portrait, phone landscape.

## Player

| Id | Story | States | Expected | Test |
|---|---|---|---|---|
| P01 | Press "Play the overview" | from the start | The board draws, the voice plays, its position moves | auto |
| P02 | Pause, then play | playing, mid-sentence | Board and voice stop at once; play continues the same sentence from the same point | auto |
| P03 | Next / previous scene | playing | Moves one scene; previous early in a scene goes to the scene before; keeps playing | auto |
| P04 | Tap a scene segment | playing, paused | Jumps to that scene; a paused player stays paused | auto |
| P05 | *bug* Mute, then unmute | playing, mid-sentence | Mute silences at once, the sentence keeps its place; unmute brings the same sentence's voice back at once (not at the next scene) | auto |
| P06 | Unmute in a sentence that started muted | playing, muted scene | The sentence's voice is fetched and joins at the matching point | auto |
| P07 | *bug-class* Change speed | playing, mid-sentence | Applies at once to the voice (playback rate) and the drawing pace | auto |
| P08 | Mute and unmute | paused | Stays paused; unmuted | auto |
| P09 | Let it play to the end, then press play | at the end | Stops on the last scene; play starts again at scene 1 | auto |
| P10 | Change style | playing | The board restyles, keeps playing | auto |
| P11 | Settings: choose, then tap outside | playing; desktop and phone | Each choice applies at once and the panel stays open; tap outside closes; there is no Done button | auto |
| P12 | Settings: Esc | desktop | Closes | auto |
| P13 | Settings sheet: X (and swipe down) | phone | X closes (swipe down is manual) | auto / manual |
| P14 | Enter and exit full screen | playing; desktop and phone | Only the player shows (no question box, tabs or account button); exit brings the page back; keeps playing | auto |
| P15 | *bug* Open settings in full screen | full screen, phone | The sheet shows on top of the player and its choices work | auto |
| P16 | Ask from full screen | full screen | Leaves full screen, puts the cursor in the question box, keeps playing | auto |
| P17 | Controls hide and come back | playing, paused | Hide about 2.5 s into playing; tap or hover brings them back; they stay while paused | auto |
| P18 | Scroll the page while playing | pinned, phone portrait | The full-size player stays pinned at the top, just the 16:9 board (no black gap), still playing | auto |
| P19 | Use the player sideways | phone landscape | The board fits the screen height; settings work in full screen | auto |
| P20 | Keyboard | desktop | Space pauses, arrows skip scenes, V mutes | auto |
| P21 | Voice can't load (signed out, nothing cached) | playing | Plays with captions only and says why | manual |

## Chat

| Id | Story | States | Expected | Test |
|---|---|---|---|---|
| C01 | Type "hello" | playing, As video | A short text reply; the board keeps playing; no Resume button | auto |
| C02 | Ask a real question as video | playing, mid-scene | Text answer, then the answer plays on the board (label "Answering your question"), only its own scenes, then pauses with "Resume overview"; Resume continues the overview | auto |
| C03 | Ask in "As text" mode | playing | Text only, the video tool isn't offered, the board isn't touched | auto |
| C04 | Tap a citation | any | Opens Sections at that section | auto |
| C05 | Daily chat limit reached | any | A clear message with when it resets | auto |
| C06 | A video answer interrupts a deep dive | playing a deep dive | The button says "Resume deep dive: <section>" | auto |
| C07 | Ask while the keyboard is open on a phone | phone | The question box stays above the keyboard | manual |

## Tracks, figures, sections

| Id | Story | States | Expected | Test |
|---|---|---|---|---|
| T01 | Deep dive from Sections, then Back | any | Plays on the board labelled "Deep dive: <section>"; Back returns to the overview | auto |
| T02 | Explain this on an equation | any | Plays an explanation labelled "Explain: …" | auto |
| T03 | Figure popup | any | Opens; closes with Esc, a tap outside, and X | auto |
| T04 | Sections outline | any | All collapsed; the filter narrows it; jump links open the section | auto |
| T05 | The first viewer of a paper (signed in) | page open | The overview starts writing in the background; play joins it | manual (needs the AI) |

## History and accounts

| Id | Story | States | Expected | Test |
|---|---|---|---|---|
| H01 | History cards replay | after playing, asking and a deep dive | One card each, in order; tapping a card plays it again | auto |
| H02 | Reload the page | after asking | The history is still there | auto |
| A01 | Signed out: ask, or deep dive | any | Sent to sign in | auto |
| A02 | Signed out: watch a saved overview | any | Plays | auto |
| A03 | New papers per day limit | 4th new paper | A clear message; nothing is written | manual (server) |
| M01 | Phone: question box | scrolled | Always visible at the bottom | auto |

## Found by the suite and the exploratory pass

New problems found by the automated stories or by clicking through every control at phone size are added here,
then given a test.

| Id | Story | Found by | Expected | Test |
|---|---|---|---|---|
| T06 | Phone: open a section and tap Deep dive, Explain this or a figure | suite (T01-T03, H01, C06 on iPhone) | The buttons can be tapped: the outline's search and index scroll with it instead of pinning under the pinned player and tabs, and jumps land below the pinned player and above the question box | T01-T03 |
| P16b | Desktop: Ask from the browser's own full screen | suite (P16 on desktop) | The question box takes focus once full screen has ended | P16 |
| P22 | Phone: tap a scene segment | exploratory sweep | Each segment has a finger-sized hit area (30 px tall), the bar itself stays thin | X01 |
| X01 | Phone sweep: every visible control in idle, playing, paused, pinned, settings, full screen, full screen settings, after a video answer, Sections and the figure popup | exploratory sweep | Every control is on screen, not cut off, and is the topmost thing where a finger lands (things behind an open sheet or popup excepted) | X01 |
