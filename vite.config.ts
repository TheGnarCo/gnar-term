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
        "src/extensions/git-status/index.ts",
        "src/extensions/agentic-orchestrator/index.ts",
        // Dominated by a Tauri event listener (installMcpOutputListener)
        // that can't be exercised without a live Tauri runtime.
        "src/lib/services/mcp-output-buffer.ts",
      ],
      thresholds: {
        lines: 73,
        branches: 84,
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
