/**
 * Tests for the v3 archive-shape migration: flattens
 * `archivedOrder: { kind, id }[]` → `string[]`, drops nested-workspace
 * archive entries, and renames `archivedDefs.groups` →
 * `archivedDefs.workspaces` (with sub-field renames).
 */
import { describe, expect, it } from "vitest";
import { migrateV3ArchiveShape } from "../lib/services/migrations/v3-archive-shape";
import type { GnarTermConfig } from "../lib/config";

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "g-1",
    name: "Group One",
    path: "/work/one",
    color: "blue",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-01-01",
    ...overrides,
  } as unknown;
}

describe("v3 archive-shape migration", () => {
  it("flattens archivedOrder, dropping nested-workspace entries", () => {
    const input = {
      archivedOrder: [
        { kind: "workspace-group", id: "g-1" },
        { kind: "workspace", id: "ws-orphan" },
        { kind: "workspace-group", id: "g-2" },
      ],
    } as unknown as GnarTermConfig;

    const out = migrateV3ArchiveShape(input);
    expect(out.archivedOrder).toEqual(["g-1", "g-2"]);
  });

  it("renames archivedDefs.groups → archivedDefs.workspaces with sub-field renames", () => {
    const group = makeWorkspace({ id: "g-1" });
    const def = {
      id: "ws-1",
      name: "WS",
      layout: { pane: { surfaces: [] } },
    };
    const input = {
      archivedDefs: {
        nestedWorkspaces: { "ws-orphan": { def } },
        groups: { "g-1": { group, workspaceDefs: [def] } },
      },
    } as unknown as GnarTermConfig;

    const out = migrateV3ArchiveShape(input);
    expect(out.archivedDefs).toEqual({
      workspaces: {
        "g-1": { workspace: group, nestedWorkspaceDefs: [def] },
      },
    });
  });

  it("is idempotent on already-migrated input", () => {
    const workspace = makeWorkspace({ id: "g-1" });
    const input = {
      archivedOrder: ["g-1"],
      archivedDefs: {
        workspaces: {
          "g-1": { workspace, nestedWorkspaceDefs: [] },
        },
      },
    } as unknown as GnarTermConfig;

    const out = migrateV3ArchiveShape(input);
    expect(out.archivedOrder).toEqual(["g-1"]);
    expect(out.archivedDefs).toEqual({
      workspaces: { "g-1": { workspace, nestedWorkspaceDefs: [] } },
    });
  });

  it("preserves already-migrated workspaces entries when both keys coexist", () => {
    const oldGroup = makeWorkspace({ id: "g-1", name: "Stale" });
    const newWs = makeWorkspace({ id: "g-1", name: "Fresh" });
    const def = { id: "ws-1", name: "WS", layout: { pane: { surfaces: [] } } };
    const input = {
      archivedDefs: {
        groups: { "g-1": { group: oldGroup, workspaceDefs: [def] } },
        workspaces: { "g-1": { workspace: newWs, nestedWorkspaceDefs: [] } },
      },
    } as unknown as GnarTermConfig;

    const out = migrateV3ArchiveShape(input);
    const workspaces = (
      out.archivedDefs as { workspaces: Record<string, unknown> }
    ).workspaces;
    expect(workspaces["g-1"]).toEqual({
      workspace: newWs,
      nestedWorkspaceDefs: [],
    });
  });

  it("is a no-op when archive fields are absent", () => {
    const input: GnarTermConfig = { theme: "dark" };
    const out = migrateV3ArchiveShape(input);
    expect(out).toEqual({ theme: "dark" });
  });

  it("renames legacy primaryWorkspaceId/dashboardWorkspaceId on archived workspace", () => {
    const legacyGroup = {
      ...makeWorkspace({ id: "g-1" }),
      primaryWorkspaceId: "ws-primary",
      dashboardWorkspaceId: "ws-dash",
    };
    const input = {
      archivedDefs: {
        groups: { "g-1": { group: legacyGroup, workspaceDefs: [] } },
      },
    } as unknown as GnarTermConfig;

    const out = migrateV3ArchiveShape(input);
    const stored = (
      out.archivedDefs as {
        workspaces: Record<
          string,
          {
            workspace: {
              primaryNestedWorkspaceId?: string;
              dashboardNestedWorkspaceId?: string;
              primaryWorkspaceId?: string;
              dashboardWorkspaceId?: string;
            };
          }
        >;
      }
    ).workspaces["g-1"];
    expect(stored?.workspace.primaryNestedWorkspaceId).toBe("ws-primary");
    expect(stored?.workspace.dashboardNestedWorkspaceId).toBe("ws-dash");
    expect(stored?.workspace.primaryWorkspaceId).toBeUndefined();
    expect(stored?.workspace.dashboardWorkspaceId).toBeUndefined();
  });
});
