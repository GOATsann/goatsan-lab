# Paper Tutor

**Any research paper, explained at a whiteboard.** Pick a paper (today's trending AI papers, a search across
arXiv and Semantic Scholar, an arXiv link, any PDF link, or your own PDF) and a tutor draws and talks you
through it in about a minute. Then deep dive into any section, ask it to explain an equation or a figure, or
interrupt it with a question: it answers on the same board and carries on. Nothing is rendered to a video file:
Claude writes a list of scenes, and your browser draws and voices them live.

BULSHY.FM EP 3.

> **New to this code?** Open this folder with an AI coding agent (Claude Code, Cursor, GitHub Copilot or
> similar) and ask it to walk you through it. For example: *"Explain how a paper goes from an arXiv link to
> the JSON map in .data/, and how the whiteboard player times each drawing step to the voice."*

## What it does

- **Find a paper.** Trending papers from Hugging Face Daily Papers; one search box over arXiv and Semantic
  Scholar that forgives look-alike spellings ("groot" finds GR00T); the newest papers in a dozen arXiv
  categories; any arXiv link; any https PDF link (whitepapers and lab reports that aren't on arXiv); or an upload.
  PDFs from links and uploads are private to the person who opened them (up to 40 MB and 150 pages).
- **Read a paper.** The arXiv LaTeX source when there is one (clean equations, real sections, the original figure
  files), else the PDF: pdf.js pulls out the text and the figures are cropped from rendered pages. One Claude pass
  maps it (sections, key claims, equations with symbols, figures, paper type -> whiteboard style).
- **The one-minute overview**, the default on every paper page. The opening scene is drawn instantly from the
  paper's title while Claude Opus 5.5 writes the rest, one validated scene per line, straight into the player.
  It is saved and replayed free for everyone after the first viewer (scenes and voice).
- **Deep dive, Explain this, and chat** (Claude Haiku 5.5, with the whole paper in a cached prompt): a section
  deep dive (60 to 90 s), a 20 to 30 s explanation of any equation or figure, and questions answered as text
  or on the whiteboard. Answers cite the section they come from. Ask while it plays: it pauses, answers on the
  board you're looking at, then replays the scene it was on and carries on.
- **Pictures for any topic.** Built-in icons (Lucide), any open-licensed icon from Iconify looked up by keyword
  ("bacteria", "neuron", "robot arm"; sets with MIT, ISC, Apache-2.0 or CC0 licences only), small line drawings
  the tutor writes itself (sanitized SVG), and the paper's own figures, used sparingly or cropped to the part
  that matters. Click a figure to open it large.
- **Layout checks** on every scene, hand-written or AI-written: estimated boxes, overlaps nudged into free
  space, arrows re-routed (or dropped) so they never cut through text.
- **Limits** per user per UTC day: 3 new papers, 10 deep dives or explanations, 50 chat messages, 5 uploads.
  Anything already made (overviews, deep dives, explanations, voice) is free and needs no sign-in.

## Run it locally

```
npm ci
cp .env.example .env.local     # then fill in the keys (never commit them; this repo is public)
npm run dev                    # http://localhost:3200
npm run typecheck
npm run build
npm run test:e2e               # the user stories (USER_STORIES.md) on desktop Chromium and iPhone WebKit
```

`npm run test:e2e` plays every control in every state (playing, paused, between scenes, at the end; normal,
pinned, full screen; desktop, phone portrait and landscape) with the voice on, checking the audio element itself.
Every API is stubbed from `e2e/fixtures` (a made-up paper, a short generated tone as the voice), so a run costs
nothing. After any change, run it and report the counts; every bug someone finds gets a story and a test first.

- `?voice=off` on any paper page plays with captions only and costs nothing. The voice button under the
  board does the same and is remembered.
- `/demo` plays a hand-written walkthrough of *Attention Is All You Need* that uses every drawing tool (no AI).
- `/api/dev/layout` (dev only) runs the layout checks over the demo and the saved overviews.
- `PAPER_TUTOR_DEV_USER=1` (dev only, ignored in production builds) pretends someone is signed in, so
  uploading and reading work without the login. For the real login locally, run the personal site on port
  3100, set `PAPER_TUTOR_DEV_USER=0`, and sign in there: the session cookie is shared across localhost ports.
- Everything the app saves (paper metadata, LaTeX text, figure crops, maps, voice files, caches) goes to
  `.data/`, which is gitignored. Delete it to start fresh.

What costs money (all cached, so each thing is paid for once): the paper map (Claude Opus 5.5, about $0.20 for a
normal paper, about $1 for a 135-page report), the overview (Opus, about $0.15 to $0.25 for a normal paper), deep
dives, explanations and chat (Claude Haiku 5.5 with prompt caching, well under a cent each), and voice (OpenAI
`gpt-4o-mini-tts`, about a cent per overview).

## The scene list

The one format everything speaks. One scene = one short narration line plus drawing steps, on a board of
1600 x 900 units ([`src/lib/scenes/types.ts`](src/lib/scenes/types.ts)):

```json
{ "say": "Here is the heart of it: scaled dot-product attention. Each word sends a query...",
  "draw": [
    { "t": "equation", "id": "eq", "tex": "\\mathrm{softmax}\\left(\\frac{\\term{qk}{QK^T}}{\\sqrt{d_k}}\\right)V", "x": 800, "y": 330 },
    { "t": "highlight", "eq": "eq", "term": "qk", "note": "how well two words match", "s": 1 },
    { "t": "camera", "focus": "eq", "zoom": 1.2, "s": 1 }
  ] }
```

| Tool | What it draws |
|---|---|
| `title` | a big centred title with a subtitle and an underline |
| `text` | a line or paragraph, with inline `$math$` |
| `box` | a rectangle, pill or circle with a label |
| `arrow` | from one element (by `id`) or point to another, straight or curved, with an optional label |
| `equation` | KaTeX; mark parts as `\term{name}{...}` so they can be highlighted |
| `highlight` | a marker swipe over an equation term, with an optional note underneath |
| `figure` | a figure from the paper, or just part of it (`crop`); click to open it large |
| `plot` | a simple bar or line chart |
| `steps` | a numbered list that appears item by item (or one item per sentence) |
| `icon` | a picture: a built-in name, or a keyword looked up on Iconify |
| `sketch` | a small line drawing written by the tutor (whitelisted SVG shapes only) |
| `group` | a few icons and labels composed into one picture |
| `camera` | zoom and pan to a point or an element |
| `erase` | fade an element out |

Timing: the narration is split into sentences, and a step starts with sentence `s` (or is spread evenly
over the sentences). A sentence starts when the one before it has finished, so the drawing follows the
real voice, and the player simply waits if a sentence's audio isn't ready yet. That is what will let scene 1
play while the AI is still writing scene 2.

## How the tutor works

- **The overview** is written once per paper by Claude Opus 5.5 (one scene per line), number-checked against the
  paper by Claude Haiku 5.5, saved, and replayed for everyone.
- **Everything interactive is one small agent** (Claude Sonnet 5.5, the whole paper in a cached prompt) with two
  tools: `show_on_video` (a list of scenes, checked and laid out before they play) and `show_figure` (opens a
  figure). A chat message always gets a text answer with its sources as `[[section]]` citations; the video tool is
  offered only when "As video" is on, and the model uses it only when a picture helps. Deep dives and Explain
  this are the same agent with a starting instruction. Every tool input is validated and a turn has at most 4
  model calls.

## How it's built

Next.js (App Router) + TypeScript, made to deploy with SST on AWS like the other builds (not deployed yet).

- `src/lib/server/` (server only; every key stays here):
  - `arxiv.ts` search, browse, metadata, source and PDF downloads behind the 3-second queue; `trending.ts`
    Hugging Face Daily Papers; `cache.ts` cached answers with a time to live.
  - `latex.ts` unpacks the source, inlines every `\input`, finds each figure's images and caption (several
    images in one figure are laid side by side). `pdf.ts` the PDF path with pdf.js and `@napi-rs/canvas`.
  - `structure.ts` the one Claude pass (structured JSON output). `papers.ts` ties it together: read once, save,
    share; uploads only for their owner.
  - `store.ts` **the storage interface**: plain files in `.data/` locally, and DynamoDB + S3 on AWS later,
    with nothing above it changing. `limits.ts` per-user daily limits (3 new papers a day to start).
  - `tts.ts` one sentence of voice, cached by its exact text. `auth.ts` who is asking.
  - `tutor/` the live tutor: `prompt.ts` the scene rules and the paper (one cached prompt for every request),
    `generate.ts` streams Claude's lines and checks each scene, `sanitize.ts` and `sketch.ts` clean them,
    `tutor.ts` the overview, deep dives, explanations and chat. `iconify.ts` icon lookups, `safeFetch.ts`
    PDF links (https only, public addresses only, size cap), `s2.ts` Semantic Scholar.
- `src/lib/scenes/layout.ts` the layout checks (overlaps and arrow routing), shared by server and browser.
- `src/lib/player/engine.ts` the player's clock: sentences, buffering, pause, scenes.
  `src/components/player/` draws each moment (`Board.tsx`) and the controls (`Whiteboard.tsx`).
- Login: the shared theonlygoatsan.com account (WorkOS AuthKit). Sign-in happens on the main site and the
  session cookie covers every subdomain; this app only reads it. Pages are public, and sign-in is asked only
  when you act (read a paper, upload, and a new voice line).

## Where it's going

1. Move the local store to DynamoDB + S3 (the interface is ready), share the arXiv queue and limits across
   server instances, and add a monthly spending cap.
2. Deploy as papers.theonlygoatsan.com.

## Credits

Code: MIT ([LICENSE](../LICENSE)). Papers belong to their authors and are fetched from arXiv and Hugging Face
on demand; none are stored in this repo. Fonts: Newsreader, Hanken Grotesk and Kalam from Google Fonts.
Equations: KaTeX. PDF reading: pdf.js. Icons: Lucide (ISC) and the open-licensed sets on Iconify.
