# Assets

Everything in the game is made for it or generated in code, except where listed.

| Asset | Source | Licence |
|---|---|---|
| Kai and Nova (`public/characters/*.glb`) | made for this project | CC-BY 4.0, like the rest of the art |
| City, trains, barriers, coins, ghost, effects | generated in code (`src/web/`) | MIT, like the code |
| Sound effects | synthesized in code (`src/web/audio.ts`) | MIT |
| Music | "Game Music" by tatamusic, via [Pixabay](https://pixabay.com/) | Pixabay Content License |

**Music is not included in this repo.** The Pixabay Content License allows using the track inside the
game and on the site, but not redistributing the file on its own. Add your own track at
`public/audio/music.mp3` (MP3, ideally a seamless loop); the game plays it if it exists and is silent
otherwise. Silence at either end of the file is skipped when looping.
