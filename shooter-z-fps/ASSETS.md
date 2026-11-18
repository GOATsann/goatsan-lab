# Assets

Everything in the game is made for it or generated in code, except where listed.

| Asset | Source | Licence |
|---|---|---|
| Dash, Bulwark, Echo and Wisp character models (`public/characters/`) | made for this project | **not included**, all rights reserved (not part of the MIT code) |
| Maps, props, scenery, sky, planet, stars | generated in code (`src/web/mapview.ts`, `src/web/textures.ts`) | MIT, like the code |
| Stand-in robots, blaster, abilities, effects | generated in code (`src/web/robot.ts`, `src/web/fx.ts`) | MIT |
| Sound effects | synthesized in code (`src/web/audio.ts`) | MIT |
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

Any other external asset added later must be CC0 (or the licence noted here).
