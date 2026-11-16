import { resolve } from "node:path";
import { defineConfig } from "vite";

// Three pages: the game, Race the AI, and the replay viewer (used by the video renderer).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        race: resolve(__dirname, "race.html"),
        replay: resolve(__dirname, "replay.html"),
      },
    },
  },
});
