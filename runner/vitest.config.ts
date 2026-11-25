// Unit tests only: test/e2e/ holds the Playwright browser tests (run with `npx playwright test`).
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, defineConfig({ test: { exclude: [...configDefaults.exclude, "test/e2e/**"] } }));
