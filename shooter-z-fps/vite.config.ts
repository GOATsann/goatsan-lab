import { resolve } from "node:path";
import { defineConfig } from "vite";

// Pages: the game (play, watch AI vs AI, free camera) and the process/capture page used to film build stages.
export default defineConfig({
  server: { port: 5190, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        capture: resolve(__dirname, "capture.html"),
      },
    },
  },
});
