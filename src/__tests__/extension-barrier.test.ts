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
      // The Diff Dashboard contribution's `create(workspace)` materializes
      // a dashboard workspace via createWorkspaceFromDef — mirrors the
      // agentic-orchestrator piercing below. global-surface-service
      // is the core registry for extension-contributed dashboard
      // components (parallel to api.registerSurfaceType, but components
      // bind to a workspace rather than a surface).
      "diff-viewer/index.ts": [
        "../../lib/services/workspace-runtime-service",
        "../../lib/services/global-surface-service",
      ],
      // DiffDashboardBody is the diff dashboard's component body — it
      // reads DashboardHostContext to discover the root workspace and
      // looks up the workspace by id from the workspaces store. Same
      // piercing shape as Kanban / ClaudeSettingsWidget.
      "diff-viewer/DiffDashboardBody.svelte": [
        "../../lib/contexts/dashboard-host",
        "../../lib/stores/workspace",
      ],
      // SpacebaseWorkspaceDashboard is the per-workspace Spacebase
      // dashboard's body — registered as a hidden surface type and
      // resolves the host workspace's CWD by id from the workspaces
      // store so it can scan `{cwd}/{syncDir}` for local .md files.
      // Same piercing shape as DiffDashboardBody.
      "spacebase/SpacebaseWorkspaceDashboard.svelte": [
        "../../lib/stores/workspace",
      ],
      // The Agentic Dashboard contribution's `create(workspace)` must
      // materialize a dashboard workspace; reaching for
      // createWorkspaceFromDef keeps the contribution on the same code
      // path as core's built-in Workspace Dashboard.
      "agentic-orchestrator/index.ts": [
        "../../lib/services/workspace-runtime-service",
        // Auto-provision: on activate, back-fill the Agentic Dashboard
        // for every existing workspace; on deactivate, close the
        // provisioned dashboards. No public ExtensionAPI surface exposes
        // the workspace list / dashboard tear-down, so the extension pierces
        // core — same shape as the existing `createWorkspaceFromDef`
        // piercing above.
        "../../lib/services/workspace-service",
        "../../lib/stores/workspace",
        // The back-fill provision loop must wait for workspaces to be
        // restored before running (races the restore loop on startup).
        // waitRestored() resolves immediately on runtime-enable, defers
        // during startup — no ExtensionAPI hook exposes this signal.
        "../../lib/bootstrap/restore-workspaces",
        // Issues + PRs are also published as dashboard sections so core
        // dashboard bodies (Workspace Overview) can compose them
        // directly. No public ExtensionAPI surface exposes the registry.
        "../../lib/services/dashboard-section-registry",
        // The Agentic Dashboard component is registered as a hidden
        // surface type via registerGlobalSurface so PaneView's
        // normal extension-surface render path mounts it. Same piercing
        // as diff-viewer/index.ts.
        "../../lib/services/global-surface-service",
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
        // workspace.path (spec §5.3). Same piercing as Kanban / AgentList.
        "../../../lib/contexts/dashboard-host",
        "../../../lib/stores/workspace",
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
        "../../../lib/stores/workspace",
      ],
      "agentic-orchestrator/components/AgentList.svelte": [
        "../../../lib/contexts/dashboard-host",
      ],
      "agentic-orchestrator/components/Kanban.svelte": [
        "../../../lib/contexts/dashboard-host",
      ],
      // AgenticDashboardBody is the per-workspace Agentic Dashboard's
      // body — registered as a hidden surface type and mounted via
      // PaneView's normal extension surface render path. Reads
      // workspace via the workspaces store, projects rootWorkspaceId
      // into a DashboardHostContext for nested widgets, and resolves
      // theme tokens for chrome (header bar). Same piercing shape as
      // ClaudeSettingsWidget and the other dashboard bodies.
      "agentic-orchestrator/components/AgenticDashboardBody.svelte": [
        "../../../lib/stores/workspace",
        "../../../lib/contexts/dashboard-host",
        "../../../lib/stores/theme",
      ],
      // GlobalAgenticDashboardBody installs a DashboardHostContext (global
      // scope) and composes Kanban + AgentList directly — no markdown
      // intermediary. The piercing covers the host-context / theme /
      // config touchpoints the body needs from core.
      "agentic-orchestrator/components/GlobalAgenticDashboardBody.svelte": [
        "../../../lib/contexts/dashboard-host",
        // Reads `pseudoWorkspaceColors` from the live config store and
        // saves color picks back from the Settings tab.
        "../../../lib/config",
        // Settings tab renders the color picker against the shared
        // theme + WORKSPACE_COLOR_SLOTS palette.
        "../../../lib/stores/theme",
        "../../../lib/theme-data",
      ],
      "agentic-orchestrator/widget-helpers.ts": [
        "../../lib/contexts/dashboard-host",
        "../../lib/stores/workspace",
        "../../lib/stores/workspace",
      ],
      // claude-settings/index.ts registers the dashboard component as a
      // hidden surface type via registerGlobalSurface so PaneView's
      // normal extension-surface render path mounts it.
      "claude-settings/index.ts": ["../../lib/services/global-surface-service"],
      // ClaudeSettingsWidget reads dashboard scope via DashboardHostContext
      // and workspace.path via workspaces — same piercing as Kanban.
      "claude-settings/components/ClaudeSettingsWidget.svelte": [
        "../../../lib/contexts/dashboard-host",
        "../../../lib/stores/workspace",
      ],
      // ClaudeSettingsBody is the surface-type body for the per-workspace
      // Claude Settings Dashboard. Projects rootWorkspaceId into a
      // DashboardHostContext so the embedded widget resolves scope.
      "claude-settings/components/ClaudeSettingsBody.svelte": [
        "../../../lib/contexts/dashboard-host",
      ],
      // SettingsFileEditor imports from the extension's own lib/ directory —
      // these are intra-extension imports, not core piercings. The test regex
      // matches any /lib/ segment, so we explicitly allow the extension-local paths.
      "claude-settings/components/SettingsFileEditor.svelte": [
        "../lib/claude-settings-service",
        "../lib/settings-schema",
      ],
      // DirListingSection and OtherSection are subdirectory components — their
      // ../../lib/ path refers to the extension's own lib/, not core lib/.
      "claude-settings/components/sections/DirListingSection.svelte": [
        "../../lib/claude-settings-service",
      ],
      "claude-settings/components/sections/OtherSection.svelte": [
        "../../lib/settings-schema",
      ],
      // branched-workspaces owns worktree and Branch creation;
      // these services live in core so existing branches stay operable
      // when the extension is disabled (the service and lifecycle events
      // remain in core). The extension pierces core the same way
      // diff-viewer and agentic-orchestrator do.
      "branched-workspaces/index.ts": [
        "../../lib/services/worktree-service",
        "../../lib/services/workspace-runtime-service",
        "../../lib/stores/workspace",
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
      let inTypeImport = false;
      for (const line of lines) {
        const trimmed = line.trimStart();
        // Allow type-only imports and type-only re-exports — neither emits a
        // runtime dependency, so they don't pierce the barrier. Track multi-line
        // `import type { ... }` blocks: if the statement doesn't close on the
        // same line (no semicolon), set a flag and clear it on the closing line.
        if (
          trimmed.startsWith("import type") ||
          trimmed.startsWith("export type")
        ) {
          if (!line.includes(";")) inTypeImport = true;
          continue;
        }
        if (inTypeImport) {
          if (line.includes(";")) inTypeImport = false;
          continue;
        }
        // Match any import from a ../../lib/ or ../../../lib/ path
        if (!line.match(/from\s+["'][^"']*\/lib\//)) continue;
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
