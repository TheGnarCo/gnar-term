/**
 * Empty Surface regression tests.
 *
 * Behavior covered:
 *   - Closing the last workspace is allowed; activeNestedWorkspaceIdx falls
 *     to -1 and no default workspace is auto-created.
 *   - The sidebar's WorkspaceListView no longer renders a "No nestedWorkspaces"
 *     placeholder for empty projects or the unclaimed zone.
 *   - App.svelte renders an EmptySurface when $nestedWorkspaces is empty.
 *   - EmptySurface sources buttons from workspaceActionStore and from
 *     the EMPTY_SURFACE_COMMAND_IDS promotion list.
 *   - App startup honors a persisted `state.nestedWorkspaces: []` as a valid
 *     restored empty state instead of auto-seeding "Workspace 1".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("sidebar: empty workspace zones render no placeholder", () => {
  const LIST_VIEW = read("src/lib/components/WorkspaceListView.svelte");
  const LIST_BLOCK = read("src/lib/components/WorkspaceListBlock.svelte");

  it("WorkspaceListView has no 'No nestedWorkspaces' text", () => {
    expect(LIST_VIEW).not.toMatch(/No nestedWorkspaces/i);
  });

  it("WorkspaceListView drops the `entries.length === 0` empty-state block", () => {
    const oneLine = LIST_VIEW.replace(/\s+/g, " ");
    expect(oneLine).not.toMatch(/\{#if\s+entries\.length\s*===\s*0\s*\}/);
  });

  it("WorkspaceListBlock has no empty-state placeholder (truly empty when no rows)", () => {
    expect(LIST_BLOCK).not.toMatch(/No nestedWorkspaces/i);
    expect(LIST_BLOCK).not.toMatch(/No workspaces/);
    const oneLine = LIST_BLOCK.replace(/\s+/g, " ");
    expect(oneLine).not.toMatch(/\{#if\s+renderedRows\.length\s*===\s*0\s*\}/);
  });
});

describe("EmptySurface copy uses 'workspaces', not the leaked identifier", () => {
  const EMPTY = read("src/lib/components/EmptySurface.svelte");

  it("does not reference the internal 'nestedWorkspaces' identifier", () => {
    expect(EMPTY).not.toMatch(/No nestedWorkspaces/i);
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
  const SVC = read("src/lib/services/nested-workspace-service.ts");

  it("closeNestedWorkspace no longer guards against wsList.length <= 1", () => {
    expect(SVC).not.toMatch(/length\s*<=\s*1/);
  });

  it("clamps activeNestedWorkspaceIdx to length - 1 (→ -1 when empty)", () => {
    expect(SVC).toMatch(/activeNestedWorkspaceIdx\.set\(\s*Math\.min\(/);
    expect(SVC).not.toMatch(/Math\.max\(\s*0\s*,\s*wsList\.length\s*-\s*1/);
  });
});

describe("EmptySurface renders and is wired up", () => {
  const APP = read("src/App.svelte");
  const EMPTY = read("src/lib/components/EmptySurface.svelte");

  it("App.svelte imports and renders EmptySurface when no workspace is active", () => {
    expect(APP).toMatch(/import EmptySurface from/);
    // Stage 7 added a pseudo-workspace gate; the orphan-dashboard fix
    // added an `activeNestedWorkspaceIdx < 0` clause so the empty surface
    // also renders when every restored workspace is a dashboard.
    expect(APP).toMatch(/\$nestedWorkspaces\.length\s*===\s*0/);
    expect(APP).toMatch(/\$activeNestedWorkspaceIdx\s*<\s*0/);
    expect(APP).toMatch(/<EmptySurface\s*\/>/);
  });

  it("EmptySurface sources buttons from workspaceActionStore and promoted commands", () => {
    expect(EMPTY).toMatch(/workspaceActionStore/);
    expect(EMPTY).toMatch(/EMPTY_SURFACE_COMMAND_IDS/);
  });

  it("promoted-commands list includes create-workspace", () => {
    const cmds = read("src/lib/services/empty-surface-commands.ts");
    expect(cmds).toMatch(/workspaces:create-workspace/);
  });
});

describe("App startup honors an explicit empty persisted state", () => {
  // Startup restoration lives in bootstrap/restore-workspaces.ts.
  const RESTORE = read("src/lib/bootstrap/restore-workspaces.ts");

  it("treats state.nestedWorkspaces = [] as a restored state (no auto-seeded NestedWorkspace 1)", () => {
    // The restore condition must accept any Array, not require non-empty.
    expect(RESTORE).toMatch(/Array\.isArray\(state\.nestedWorkspaces\)/);
    // The old "state.nestedWorkspaces && state.nestedWorkspaces.length > 0" gate
    // would re-seed NestedWorkspace 1 on an empty persisted state.
    const oneLine = RESTORE.replace(/\s+/g, " ");
    expect(oneLine).not.toMatch(
      /if\s*\(\s*state\.nestedWorkspaces\s*&&\s*state\.nestedWorkspaces\.length\s*>\s*0\s*\)/,
    );
  });
});
