# Assets

Everything in the game is made for it or generated in code, except where listed.

| Asset | Source | Licence |
|---|---|---|
| Kai and Nova (`public/characters/`) | made for this project | **not included**, all rights reserved (also `public/og.png` and the app icons, which show them) |
| City, trains, barriers, coins, ghost, effects | generated in code (`src/web/`) | MIT, like the code |
| Sound effects | synthesized in code (`src/web/audio.ts`) | MIT |
| Music | "Game Music" by tatamusic, via [Pixabay](https://pixabay.com/) | Pixabay Content License |

**Kai and Nova are not included in this repo.** Without them the game uses its built-in capsule
couriers (same names and colours, made of simple shapes in `src/web/character.ts`). To use your own
characters, put rigged GLB models in `public/characters/` with a `characters.json` like this:

```json
[
  { "id": "boy", "name": "Kai", "file": "boy.glb", "scale": 1, "colors": { "accent": "#22E3F0" } },
  { "id": "girl", "name": "Nova", "file": "girl.glb", "scale": 1, "colors": { "accent": "#FF6B5B" } }
]
```

The models need run, jump and roll animations; the details are in `src/web/character.ts`. Characters
never change the gameplay: hitboxes live in the core.

**Music is not included in this repo.** The Pixabay Content License allows using the track inside the
game and on the site, but not redistributing the file on its own. Add your own track at
`public/audio/music.mp3` (MP3, ideally a seamless loop); the game plays it if it exists and is silent
otherwise. Silence at either end of the file is skipped when looping.
