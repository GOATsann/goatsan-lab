# Paper Tutor

**Any research paper, explained at a whiteboard.** Pick a paper (today's trending AI papers, an arXiv search,
an arXiv link, or your own PDF) and a tutor draws and talks you through it. Nothing is rendered to a video
file: the tutor writes a list of scenes, and your browser draws and voices them live.

BULSHY.FM EP 3. Work in progress: finding papers, reading them, and the whiteboard player work. The AI that
writes the scenes live is the next step (see "Where it's going").

> **New to this code?** Open this folder with an AI coding agent (Claude Code, Cursor, GitHub Copilot or
> similar) and ask it to walk you through it. For example: *"Explain how a paper goes from an arXiv link to
> the JSON map in .data/, and how the whiteboard player times each drawing step to the voice."*

## What works now

- **Find a paper.** Trending papers from Hugging Face Daily Papers; arXiv search; the newest papers in a
  dozen arXiv categories; paste any arXiv link or id; or upload a PDF (up to 20 MB and 60 pages, visible
  only to you). Every arXiv call goes through one queue that waits 3 seconds between requests, as arXiv
  asks, and every answer is cached, so the same thing is never fetched twice.
- **Read a paper.** The arXiv LaTeX source when there is one (clean equations, real sections, the original
  figure files), else the PDF: pdf.js pulls out the text and the figures are cropped from rendered pages,
  using the "Figure N:" captions to find them. Then one Claude pass maps the paper: sections with summaries,
  key claims, each important equation with its symbols, the figures, and the paper type, which picks the
  whiteboard style. The map is saved once per paper and shared (uploads stay private).
- **The whiteboard player.** Plays a scene list with a small, fixed set of drawing tools, in three styles
  (Chalkboard, Diagram, Illustrated), with a voice per sentence (OpenAI text-to-speech) or captions only.
  A hand-written demo for *Attention Is All You Need* plays end to end at `/paper/1706.03762`.

## Run it locally

```
npm ci
cp .env.example .env.local     # then fill in the keys (never commit them; this repo is public)
npm run dev                    # http://localhost:3200
npm run typecheck
npm run build
```

- `?voice=off` on any paper page plays with captions only and costs nothing. The voice button under the
  board does the same and is remembered.
- `PAPER_TUTOR_DEV_USER=1` (dev only, ignored in production builds) pretends someone is signed in, so
  uploading and reading work without the login. For the real login locally, run the personal site on port
  3100, set `PAPER_TUTOR_DEV_USER=0`, and sign in there: the session cookie is shared across localhost ports.
- Everything the app saves (paper metadata, LaTeX text, figure crops, maps, voice files, caches) goes to
  `.data/`, which is gitignored. Delete it to start fresh.

What costs money: reading a paper with Claude (about $0.20 for *Attention Is All You Need*: 21k tokens in,
6k out on Claude Opus 5.5) and new voice lines (OpenAI `gpt-4o-mini-tts`, a few cents for the whole demo).
Both are cached, so a paper or a sentence is only paid for once.

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
| `figure` | a figure crop from the paper (`fig1`, `fig2`, ...) |
| `plot` | a simple bar or line chart |
| `steps` | a numbered list that appears item by item (or one item per sentence) |
| `camera` | zoom and pan to a point or an element |
| `erase` | fade an element out |

Timing: the narration is split into sentences, and a step starts with sentence `s` (or is spread evenly
over the sentences). A sentence starts when the one before it has finished, so the drawing follows the
real voice, and the player simply waits if a sentence's audio isn't ready yet. That is what will let scene 1
play while the AI is still writing scene 2.

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
- `src/lib/player/engine.ts` the player's clock: sentences, buffering, pause, scenes.
  `src/components/player/` draws each moment (`Board.tsx`) and the controls (`Whiteboard.tsx`).
- Login: the shared theonlygoatsan.com account (WorkOS AuthKit). Sign-in happens on the main site and the
  session cookie covers every subdomain; this app only reads it. Pages are public, and sign-in is asked only
  when you act (read a paper, upload, and a new voice line).

## Where it's going

1. **Live tutor (next):** Claude streams scene lists into the player, one scene per line, so the first
   picture and word arrive in a few seconds. The 60-second overview per paper is made once and replayed for
   everyone.
2. Deep dive into any section and "Explain this" on any equation or figure.
3. Chat about the paper, answered as text or on the whiteboard, and you can interrupt the tutor to ask.
4. Limits and a monthly spending cap, then deploy.

## Credits

Code: MIT ([LICENSE](../LICENSE)). Papers belong to their authors and are fetched from arXiv and Hugging Face
on demand; none are stored in this repo. Fonts: Newsreader, Hanken Grotesk and Kalam from Google Fonts.
Equations: KaTeX. PDF reading: pdf.js.
