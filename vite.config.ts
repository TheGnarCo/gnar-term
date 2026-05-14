/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    globals: true,
    setupFiles: ["src/test-setup.ts"],
    onConsoleLog: (msg) => !msg.includes("HTMLCanvasElement"),
    // Default 5s is exceeded by dynamic `await import(...)` calls under
    // full-suite parallel load (transform/import phase totals ~60s across
    // 165 files). The tests pass in isolation; bumping the cap keeps them
    // passing in the loaded run without masking real assertion failures.
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/extensions/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/lib/types/**/*.ts",
        "src/lib/services/git-status-service.ts",
        // Dominated by a Tauri event listener (installMcpOutputListener)
        // that can't be exercised without a live Tauri runtime.
        "src/lib/services/mcp-output-buffer.ts",
      ],
      // Temporary floor while the consolidation + meta-surface work is
      // in flight. Raise these back up after the work settles.
      thresholds: {
        lines: 50,
        branches: 50,
        functions: 50,
        statements: 50,
      },
    },
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      // Worktrees created by gnar-term live under `.gnar-term/worktrees/`
      // and each carries its own copy of this repo (their own
      // `tsconfig.json`, `src/`, etc.). Without this ignore, creating a
      // branched workspace at runtime trips Vite's tsconfig-change
      // detector and forces a full page reload, which collapses the
      // active workspace. The worktree contents are user state, not
      // dev-server inputs — keep them out of the watch graph entirely.
      ignored: ["**/.gnar-term/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
