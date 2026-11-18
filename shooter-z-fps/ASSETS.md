# Assets

Everything in the game is made for it or generated in code, except where listed.

| Asset | Source | Licence |
|---|---|---|
| Dash, Bulwark, Echo and Wisp character models (`public/characters/`) | made for this project | **not included**, all rights reserved (not part of the MIT code) |
| The trained AI (`public/models/shooter-ai.onnx` + `shooter-ai.json`) | trained for this project (`train/`) | **not included**: published on Hugging Face, copied here for local play |
| Maps, props, scenery, sky, planet, stars | generated in code (`src/web/mapview.ts`, `src/web/textures.ts`) | MIT, like the code |
| Stand-in robots, blaster, abilities, effects | generated in code (`src/web/robot.ts`, `src/web/fx.ts`) | MIT |
| Special Move sounds and the ready chime (`public/sfx/`: dash, bulwark, echo, wisp, ready) | generated for this project with Higgsfield (Mirelo SFX), then trimmed and normalised | **not included**, all rights reserved (not part of the MIT code) |
| Other sound effects (lasers, hits, eliminations, reload, jump) and the Special Move stand-ins | synthesized in code (`src/web/audio.ts`) | MIT |
| Fonts: Chakra Petch, Inter | loaded at runtime from Google Fonts | SIL Open Font License 1.1 |

**The four character models are not included in this repo.** Without them the game uses its built-in
stand-in robots (same names, one accessory per character, made of simple shapes in `src/web/robot.ts`). To
use your own characters, put rigged GLB models in `public/characters/` with a `characters.json` like this
(`character` is the index in `src/core/characters.ts`: 0 Dash, 1 Bulwark, 2 Echo, 3 Wisp):

```json
[
  { "id": "dash", "character": 0, "file": "dash.glb" },
  { "id": "bulwark", "character": 1, "file": "bulwark.glb" },
  { "id": "echo", "character": 2, "file": "echo.glb" },
  { "id": "wisp", "character": 3, "file": "wisp.glb" }
]
```

The models need one skin and the clips listed in `src/web/character.ts` (idle, run, strafe, jump, crouch,
shoot, hit, eliminated, spawn, special); the game puts the blaster in the right hand. Keep them light
(the four made for the game are about 1 MB and 14.5k triangles each, 1024 px textures). Characters never
change the gameplay: hitboxes live in the core.

**The Special Move sounds are not included in this repo either.** Without them the game plays synthesized
stand-ins. To use your own, put short mono MP3 files in `public/sfx/` named `dash.mp3`, `bulwark.mp3`,
`echo.mp3`, `wisp.mp3` and `ready.mp3` (the ones made for the game are 0.7-2 s and 9-25 KB each).

Any other external asset added later must be CC0 (or the licence noted here).
