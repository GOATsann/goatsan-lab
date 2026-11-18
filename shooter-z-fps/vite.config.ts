import { resolve } from "node:path";
import { defineConfig } from "vite";

// Pages: the game (play, watch AI vs AI, free camera) and the process/capture page used to film build stages.
export default defineConfig({
  // host: true so a phone on the same Wi-Fi can open the dev server (http://<this Mac's IP>:5190)
  server: { port: 5190, strictPort: true, host: true },
  // onnxruntime-web loads its .wasm (and proxy worker) next to its own JS; pre-bundling breaks that path in dev
  optimizeDeps: { exclude: ["onnxruntime-web", "onnxruntime-web/wasm"] },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        capture: resolve(__dirname, "capture.html"),
      },
    },
  },
});
