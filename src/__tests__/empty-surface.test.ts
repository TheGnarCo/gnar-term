/**
 * Empty Surface regression tests.
 *
 * Behavior covered:
 *   - Closing the last workspace is allowed; activeWorkspaceIdx falls
 *     to -1 and no default workspace is auto-created.
 *   - The sidebar's WorkspaceListView no longer renders a "No workspaces"
 *     placeholder for empty projects or the unclaimed zone.
 *   - App.svelte renders an EmptySurface when $workspaces is empty.
 *   - EmptySurface sources buttons from workspaceActionStore and from
 *     the EMPTY_SURFACE_COMMAND_IDS promotion list.
 *   - App startup honors a persisted `state.workspaces: []` as a valid
 *     restored empty state instead of auto-seeding "Workspace 1".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("sidebar: empty workspace zones render no placeholder", () => {
  const LIST_VIEW = read("src/lib/components/WorkspaceListView.svelte");

  it("WorkspaceListView has no 'No workspaces' text", () => {
    expect(LIST_VIEW).not.toMatch(/No workspaces/i);
  });

  it("WorkspaceListView drops the `entries.length === 0` empty-state block", () => {
    const oneLine = LIST_VIEW.replace(/\s+/g, " ");
    expect(oneLine).not.toMatch(/\{#if\s+entries\.length\s*===\s*0\s*\}/);
  });
});

describe("terminal-service: pty close does not auto-seed a workspace", () => {
  const TS = read("src/lib/terminal-service.ts");

  it("removes the needsDefaultWorkspace flag entirely", () => {
    expect(TS).not.toMatch(/needsDefaultWorkspace/);
  });

  it("does not call createDefaultWorkspace from the pty-close handler", () => {
    // createDefaultWorkspace may still be an exported helper for
    // explicit use; it just must not be invoked from the close path.
    const pty = TS.match(/"pty-close"[\s\S]*?^\s*\}\);/m)?.[0] ?? "";
    expect(pty).not.toMatch(/createDefaultWorkspace\s*\(/);
  });
});

describe("workspace-service: closing the last workspace is allowed", () => {
  const SVC = read("src/lib/services/workspace-service.ts");

  it("closeWorkspace no longer guards against wsList.length <= 1", () => {
    expect(SVC).not.toMatch(/length\s*<=\s*1/);
  });

  it("clamps activeWorkspaceIdx to length - 1 (→ -1 when empty)", () => {
    expect(SVC).toMatch(/activeWorkspaceIdx\.set\(\s*Math\.min\(/);
    expect(SVC).not.toMatch(/Math\.max\(\s*0\s*,\s*wsList\.length\s*-\s*1/);
  });
});

describe("EmptySurface renders and is wired up", () => {
  const APP = read("src/App.svelte");
  const EMPTY = read("src/lib/components/EmptySurface.svelte");

  it("App.svelte imports and renders EmptySurface when no workspace is active", () => {
    expect(APP).toMatch(/import EmptySurface from/);
    // Stage 7 added a pseudo-workspace gate; the orphan-dashboard fix
    // added an `activeWorkspaceIdx < 0` clause so the empty surface
    // also renders when every restored workspace is a dashboard.
    expect(APP).toMatch(/\$workspaces\.length\s*===\s*0/);
    expect(APP).toMatch(/\$activeWorkspaceIdx\s*<\s*0/);
    expect(APP).toMatch(/<EmptySurface\s*\/>/);
  });

  it("EmptySurface sources buttons from workspaceActionStore and promoted commands", () => {
    expect(EMPTY).toMatch(/workspaceActionStore/);
    expect(EMPTY).toMatch(/EMPTY_SURFACE_COMMAND_IDS/);
  });

  it("promoted-commands list includes create-workspace-group", () => {
    const cmds = read("src/lib/services/empty-surface-commands.ts");
    expect(cmds).toMatch(/workspace-groups:create-workspace-group/);
  });
});

describe("App startup honors an explicit empty persisted state", () => {
  // Startup restoration lives in bootstrap/restore-workspaces.ts.
  const RESTORE = read("src/lib/bootstrap/restore-workspaces.ts");

  it("treats state.workspaces = [] as a restored state (no auto-seeded Workspace 1)", () => {
    // The restore condition must accept any Array, not require non-empty.
    expect(RESTORE).toMatch(/Array\.isArray\(state\.workspaces\)/);
    // The old "state.workspaces && state.workspaces.length > 0" gate
    // would re-seed Workspace 1 on an empty persisted state.
    const oneLine = RESTORE.replace(/\s+/g, " ");
    expect(oneLine).not.toMatch(
      /if\s*\(\s*state\.workspaces\s*&&\s*state\.workspaces\.length\s*>\s*0\s*\)/,
    );
  });
});
