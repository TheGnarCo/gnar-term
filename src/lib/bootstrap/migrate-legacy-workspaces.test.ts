import { describe, it, expect } from "vitest";
import { migrateLegacyWorkspaces } from "./migrate-legacy-workspaces";
import type { AppState, WorkspaceDef, LayoutNode } from "../config";
import type { WorkspaceRecord } from "../stores/workspace";

// Pre-Stage-10 record shape — the migration reads this legacy field;
// the live WorkspaceRecord interface no longer carries it.
type LegacyWorkspaceRecord = WorkspaceRecord & {
  primaryBranchedWorkspaceId?: string;
};

const layout = (id: string): LayoutNode => ({
  pane: { surfaces: [{ type: "terminal", cwd: `/cwd/${id}` }] },
});

const emptyLayout: LayoutNode = { pane: { surfaces: [] } };

const parent = (
  over: Partial<LegacyWorkspaceRecord> = {},
): LegacyWorkspaceRecord => ({
  id: "P",
  name: "Project",
  path: "/p",
  color: "blue",
  branchedWorkspaceIds: [],
  isGit: true,
  createdAt: "2026-01-01",
  ...over,
});

const wsdef = (over: Partial<WorkspaceDef> & { id: string }): WorkspaceDef => ({
  name: over.name ?? `ws-${over.id}`,
  layout: over.layout ?? layout(over.id),
  ...over,
});

describe("migrateLegacyWorkspaces", () => {
  it("is a no-op when there are no parent workspaces", () => {
    const state: AppState = {
      workspaces: [wsdef({ id: "B1" })],
      activeWorkspaceId: "B1",
    };
    expect(migrateLegacyWorkspaces(state)).toBe(state);
  });

  it("merges a project + its primary into a single Workspace using the project id", () => {
    const state: AppState = {
      parentWorkspaces: [parent({ id: "P", primaryBranchedWorkspaceId: "B1" })],
      activeParentWorkspaceId: "P",
      workspaces: [wsdef({ id: "B1", layout: layout("B1") })],
    };

    const out = migrateLegacyWorkspaces(state);

    expect(out.parentWorkspaces).toBeUndefined();
    expect(out.activeParentWorkspaceId).toBeUndefined();
    expect(out.workspaces).toHaveLength(1);
    const merged = out.workspaces?.[0];
    expect(merged?.id).toBe("P");
    expect(merged?.layout).toEqual(layout("B1"));
    expect(merged?.path).toBe("/p");
    expect(merged?.color).toBe("blue");
    expect(merged?.isGit).toBe(true);
    expect(merged?.createdAt).toBe("2026-01-01");
    // Active id was the project; stays the project
    expect(out.activeWorkspaceId).toBe("P");
  });

  it("preserves Branches that point at the project (rootWorkspaceId === P.id) and leaves their refs valid", () => {
    const state: AppState = {
      parentWorkspaces: [parent({ id: "P", primaryBranchedWorkspaceId: "B1" })],
      workspaces: [
        wsdef({ id: "B1" }),
        wsdef({ id: "B2", rootWorkspaceId: "P", worktreePath: "/wt/2" }),
        wsdef({ id: "B3", rootWorkspaceId: "P", worktreePath: "/wt/3" }),
      ],
    };

    const out = migrateLegacyWorkspaces(state);
    const ids = out.workspaces?.map((w) => w.id);
    expect(ids).toEqual(["P", "B2", "B3"]);
    expect(out.workspaces?.find((w) => w.id === "B2")?.rootWorkspaceId).toBe(
      "P",
    );
  });

  it("uses an empty layout when the project has no primary branched workspace", () => {
    const state: AppState = {
      parentWorkspaces: [parent({ id: "P" })],
      workspaces: [],
    };
    const out = migrateLegacyWorkspaces(state);
    expect(out.workspaces?.[0]?.layout).toEqual(emptyLayout);
  });

  it("uses an empty layout when the primary id points at a missing record", () => {
    const state: AppState = {
      parentWorkspaces: [
        parent({ id: "P", primaryBranchedWorkspaceId: "missing" }),
      ],
      workspaces: [],
    };
    const out = migrateLegacyWorkspaces(state);
    expect(out.workspaces?.[0]?.layout).toEqual(emptyLayout);
  });

  it("redirects activeWorkspaceId from absorbed primary to project id", () => {
    const state: AppState = {
      parentWorkspaces: [parent({ id: "P", primaryBranchedWorkspaceId: "B1" })],
      workspaces: [wsdef({ id: "B1" })],
      activeWorkspaceId: "B1",
    };
    expect(migrateLegacyWorkspaces(state).activeWorkspaceId).toBe("P");
  });

  it("preserves activeWorkspaceId when it points at a non-absorbed Branch", () => {
    const state: AppState = {
      parentWorkspaces: [parent({ id: "P", primaryBranchedWorkspaceId: "B1" })],
      workspaces: [
        wsdef({ id: "B1" }),
        wsdef({ id: "B2", rootWorkspaceId: "P" }),
      ],
      activeWorkspaceId: "B2",
    };
    expect(migrateLegacyWorkspaces(state).activeWorkspaceId).toBe("B2");
  });

  it("falls back to activeParentWorkspaceId when activeWorkspaceId is unset", () => {
    const state: AppState = {
      parentWorkspaces: [parent({ id: "P", primaryBranchedWorkspaceId: "B1" })],
      workspaces: [wsdef({ id: "B1" })],
      activeParentWorkspaceId: "P",
    };
    expect(migrateLegacyWorkspaces(state).activeWorkspaceId).toBe("P");
  });

  it("drops lastActiveBranchedWorkspaceId when it pointed at the absorbed primary", () => {
    const state: AppState = {
      parentWorkspaces: [
        parent({
          id: "P",
          primaryBranchedWorkspaceId: "B1",
          lastActiveBranchedWorkspaceId: "B1",
        }),
      ],
      workspaces: [wsdef({ id: "B1" })],
    };
    const out = migrateLegacyWorkspaces(state);
    expect(out.workspaces?.[0]?.lastActiveBranchedWorkspaceId).toBeUndefined();
  });

  it("keeps lastActiveBranchedWorkspaceId when it points at a non-primary Branch", () => {
    const state: AppState = {
      parentWorkspaces: [
        parent({
          id: "P",
          primaryBranchedWorkspaceId: "B1",
          lastActiveBranchedWorkspaceId: "B2",
        }),
      ],
      workspaces: [
        wsdef({ id: "B1" }),
        wsdef({ id: "B2", rootWorkspaceId: "P" }),
      ],
    };
    const out = migrateLegacyWorkspaces(state);
    expect(
      out.workspaces?.find((w) => w.id === "P")?.lastActiveBranchedWorkspaceId,
    ).toBe("B2");
  });

  it("carries over the primary's extensionData onto the merged Workspace", () => {
    const ext = { fooKey: "bar" };
    const state: AppState = {
      parentWorkspaces: [parent({ id: "P", primaryBranchedWorkspaceId: "B1" })],
      workspaces: [wsdef({ id: "B1", extensionData: ext })],
    };
    const out = migrateLegacyWorkspaces(state);
    expect(out.workspaces?.[0]?.extensionData).toEqual(ext);
  });

  it("preserves Dashboards (rootWorkspaceId + isDashboard) untouched", () => {
    const state: AppState = {
      parentWorkspaces: [
        parent({
          id: "P",
          primaryBranchedWorkspaceId: "B1",
          dashboardWorkspaceId: "D1",
        }),
      ],
      workspaces: [
        wsdef({ id: "B1" }),
        wsdef({
          id: "D1",
          rootWorkspaceId: "P",
          isDashboard: true,
          dashboardContributionId: "overview",
        }),
      ],
    };
    const out = migrateLegacyWorkspaces(state);
    const dash = out.workspaces?.find((w) => w.id === "D1");
    expect(dash?.isDashboard).toBe(true);
    expect(dash?.rootWorkspaceId).toBe("P");
    expect(
      out.workspaces?.find((w) => w.id === "P")?.dashboardWorkspaceId,
    ).toBe("D1");
  });

  it("handles multiple projects independently", () => {
    const state: AppState = {
      parentWorkspaces: [
        parent({
          id: "P1",
          name: "Proj1",
          path: "/p1",
          primaryBranchedWorkspaceId: "B1",
        }),
        parent({
          id: "P2",
          name: "Proj2",
          path: "/p2",
          primaryBranchedWorkspaceId: "B2",
        }),
      ],
      workspaces: [wsdef({ id: "B1" }), wsdef({ id: "B2" })],
    };
    const out = migrateLegacyWorkspaces(state);
    expect(out.workspaces?.map((w) => w.id)).toEqual(["P1", "P2"]);
    expect(out.workspaces?.find((w) => w.id === "P1")?.path).toBe("/p1");
    expect(out.workspaces?.find((w) => w.id === "P2")?.path).toBe("/p2");
  });

  it("propagates the locked flag when the parent was locked", () => {
    const state: AppState = {
      parentWorkspaces: [
        parent({ id: "P", primaryBranchedWorkspaceId: "B1", locked: true }),
      ],
      workspaces: [wsdef({ id: "B1" })],
    };
    expect(migrateLegacyWorkspaces(state).workspaces?.[0]?.locked).toBe(true);
  });

  it("propagates autoRunRestoreCommands when set on the parent", () => {
    const state: AppState = {
      parentWorkspaces: [
        parent({
          id: "P",
          primaryBranchedWorkspaceId: "B1",
          autoRunRestoreCommands: false,
        }),
      ],
      workspaces: [wsdef({ id: "B1" })],
    };
    expect(
      migrateLegacyWorkspaces(state).workspaces?.[0]?.autoRunRestoreCommands,
    ).toBe(false);
  });
});
