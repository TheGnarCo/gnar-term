/**
 * Extension Barrier — Story C
 *
 * Tests that no extension imports directly from core internals (../../lib/).
 * Also verifies that the new API methods exist on the ExtensionAPI interface.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const EXTENSIONS_DIR = path.resolve(__dirname, "../extensions");

/** Recursively find all .ts and .svelte files in a directory */
function findSourceFiles(dir: string): string[] {
  const results: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test reads extension source files to validate import boundaries
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "__tests__") {
      results.push(...findSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".svelte")) {
      // Skip test files — they legitimately import from core for testing
      if (!entry.name.endsWith(".test.ts")) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

describe("Extension barrier enforcement", () => {
  const extensionFiles = findSourceFiles(EXTENSIONS_DIR);

  it("found extension source files to check", () => {
    expect(extensionFiles.length).toBeGreaterThan(0);
  });

  it("no extension file imports from core lib (except allowed utilities)", () => {
    // Allowed: types (type definitions), extension-types (shared type definitions)
    const ALLOWED_IMPORTS = ["/types"];
    // Per-file barrier exceptions for included extensions that own
    // first-class persisted entities in GnarTermConfig (parallel to
    // worktree-service which lives in core for the same reason).
    // Keep this list small — each entry is a deliberate departure.
    const FILE_EXCEPTIONS: Record<string, string[]> = {
      // The Diff Dashboard contribution's `create(group)` materializes
      // a dashboard workspace via createWorkspaceFromDef — mirrors the
      // agentic-orchestrator piercing below.
      "diff-viewer/index.ts": ["../../lib/services/workspace-service"],
      // The Agentic Dashboard contribution's `create(group)` must
      // materialize a dashboard workspace; reaching for
      // createWorkspaceFromDef keeps the contribution on the same code
      // path as core's built-in Group Dashboard.
      "agentic-orchestrator/index.ts": [
        "../../lib/services/workspace-service",
        // The extension mirrors its declared `globalAgentsMarkdownPath`
        // setting into `config.agenticGlobal.markdownPath` so the
        // Global Agentic Dashboard body + Stage-8 migration share one
        // canonical location. Reaching the config helpers directly is
        // the simplest sync path.
        "../../lib/config",
        // Auto-provision: on activate, back-fill the Agentic Dashboard
        // for every existing workspace group; on deactivate, close the
        // provisioned dashboards. No public ExtensionAPI surface exposes
        // the group list / dashboard tear-down, so the extension pierces
        // core — same shape as the existing `createWorkspaceFromDef`
        // piercing above.
        "../../lib/services/workspace-group-service",
        "../../lib/stores/workspace-groups",
      ],
      // Issues + TaskSpawner widgets call the shared spawn-helper
      // (core service that composes worktree-service + agent command
      // construction). The MCP `spawn_agent` tool calls the same helper
      // when its worktree flag is set — keeping the widgets and MCP on
      // the same code path is the whole point of the helper.
      "agentic-orchestrator/components/Issues.svelte": [
        "../../../lib/services/spawn-helper",
        // Shared gh-availability probe — cached across widgets so a user
        // with many dashboards doesn't fan out a dozen redundant
        // `gh --version` calls on mount.
        "../../../lib/services/gh-availability",
        // Dashboard widgets derive scope from DashboardHostContext +
        // group.path (spec §5.3). Same piercing as Kanban / AgentList.
        "../../../lib/contexts/dashboard-host",
        "../../../lib/stores/workspace-groups",
      ],
      // Prs is the read-only sibling of Issues — same gh-availability
      // probe + DashboardHostContext piercings, but no spawn-helper
      // since the widget never spawns workspaces.
      "agentic-orchestrator/components/Prs.svelte": [
        "../../../lib/services/gh-availability",
        "../../../lib/contexts/dashboard-host",
      ],
      "agentic-orchestrator/components/TaskSpawner.svelte": [
        "../../../lib/services/spawn-helper",
        "../../../lib/contexts/dashboard-host",
        "../../../lib/stores/workspace-groups",
      ],
      "agentic-orchestrator/components/AgentList.svelte": [
        "../../../lib/contexts/dashboard-host",
      ],
      "agentic-orchestrator/components/Kanban.svelte": [
        "../../../lib/contexts/dashboard-host",
      ],
      // GlobalAgenticDashboardBody is the Global Agentic Dashboard
      // pseudo-workspace's body; it installs a DashboardHostContext
      // (global scope) and drives the same markdown-preview pipeline
      // core uses for real dashboards. Stage 7 introduced this piercing
      // when the pseudo-workspace replaced the orchestrator root row.
      "agentic-orchestrator/components/GlobalAgenticDashboardBody.svelte": [
        "../../../lib/contexts/dashboard-host",
        "../../../lib/services/preview-surface-registry",
        "../../../lib/services/preview-service",
        // Reads `config.agenticGlobal.markdownPath` to honor the user's
        // configured Global Agentic Dashboard markdown location, and
        // saves `pseudoWorkspaceColors` back from the Settings tab.
        "../../../lib/config",
        // Settings tab renders the color picker against the shared
        // theme + PROJECT_COLOR_SLOTS palette.
        "../../../lib/stores/theme",
        "../../../lib/theme-data",
        // Regenerate Dashboard button shows a confirmation prompt before
        // overwriting user edits — same pattern as GroupDashboardSettings.
        "../../../lib/stores/ui",
      ],
      "agentic-orchestrator/widget-helpers.ts": [
        "../../lib/contexts/dashboard-host",
        "../../lib/stores/workspace",
        "../../lib/stores/workspace-groups",
        "../../lib/services/claimed-workspace-registry",
      ],
      // Columns layout widget looks up registered markdown components by
      // name so authors can place arbitrary `gnar:*` widgets in columns
      // from the dashboard template. Reaching the core registry is the
      // cleanest hook for that — no extension-facing API exposes it and
      // duplicating the lookup logic would invite drift.
      "agentic-orchestrator/components/Columns.svelte": [
        "../../../lib/services/markdown-component-registry",
      ],
    };
    const violations: string[] = [];
    for (const file of extensionFiles) {
      if (file.endsWith("/api.ts")) continue;
      const relPath = path.relative(EXTENSIONS_DIR, file);
      const fileExceptions = FILE_EXCEPTIONS[relPath] ?? [];
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test reads extension source files to validate import boundaries
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        // Match any import from a ../../lib/ or ../../../lib/ path
        if (!line.match(/from\s+["'][^"']*\/lib\//)) continue;
        // Allow type-only imports and type-only re-exports — neither
        // emits a runtime dependency, so they don't pierce the barrier.
        const trimmed = line.trimStart();
        if (trimmed.startsWith("import type")) continue;
        if (trimmed.startsWith("export type")) continue;
        // Allow specific utilities
        if (ALLOWED_IMPORTS.some((mod) => line.includes(mod))) continue;
        // Allow per-file exceptions
        if (fileExceptions.some((mod) => line.includes(`"${mod}"`))) continue;
        violations.push(`${relPath}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no extension file imports from another extension directory", () => {
    const violations: string[] = [];
    for (const file of extensionFiles) {
      if (file.endsWith("/api.ts")) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test reads extension source files to validate import boundaries
      const content = fs.readFileSync(file, "utf-8");
      // Determine this file's extension directory (e.g., "preview" for preview/previewers/foo.ts)
      const relToExtensions = path.relative(EXTENSIONS_DIR, file);
      const extensionDir = relToExtensions.split(path.sep)[0];
      const lines = content.split("\n");
      for (const line of lines) {
        const match = line.match(/from\s+["']\.\.\/(\w[\w-]*)(?:\/|["'])/);
        if (!match) continue;
        const importTarget = match[1];
        // Allow: ../api (public contract), ../shared (shared helpers for included extensions)
        if (importTarget === "api" || importTarget === "shared") continue;
        // For files in subdirectories, ../ stays within the same extension — skip
        const depth = relToExtensions.split(path.sep).length;
        if (depth > 2) continue; // subdirectory file — ../ doesn't escape the extension
        // Top-level extension file importing from another extension
        if (importTarget !== extensionDir) {
          violations.push(`${relToExtensions} imports from ../${importTarget}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
