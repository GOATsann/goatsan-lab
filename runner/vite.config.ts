import { resolve } from "node:path";
import { defineConfig } from "vite";

// Pages: the game, Race the AI, Watch the AI, and the replay viewer (used by the video renderer).
export default defineConfig({
  // onnxruntime-web loads its .wasm next to its own JS; Vite's pre-bundling breaks that path in dev
  optimizeDeps: { exclude: ["onnxruntime-web", "onnxruntime-web/wasm"] },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        race: resolve(__dirname, "race.html"),
        replay: resolve(__dirname, "replay.html"),
        watch: resolve(__dirname, "watch.html"),
      },
    },
  },
});
