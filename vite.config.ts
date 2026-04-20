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
    onConsoleLog: (msg) => !msg.includes("HTMLCanvasElement"),
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/extensions/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/lib/types/**/*.ts",
        "src/extensions/agentic-orchestrator/index.ts",
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
  },
  envPrefix: ["VITE_", "TAURI_"],
  optimizeDeps: {
    exclude: ["@embedpdf/snippet"],
  },
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
