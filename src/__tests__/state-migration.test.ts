/**
 * Tests for the on-load AppState shape migration (paired with v1/v2
 * config migrations). Covers:
 *   - projectId → groupId on workspace metadata (Stage 2b)
 *   - parentOrchestratorId → spawnedBy (Stage 8)
 *   - orchestratorId + isDashboard → dashboardContributionId="agentic"
 *   - rootRowOrder of kind "project" → "workspace-group"
 *   - rootRowOrder of kind "agent-orchestrator" → dropped
 *
 * Idempotency: the function runs on every load, so a migrated shape
 * round-trips through unchanged.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => p),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { migrateLegacyProjectShapes } from "../lib/config";
import type { AppState } from "../lib/config";

type WorkspaceLike = NonNullable<AppState["workspaces"]>[number];

function makeWs(
  id: string,
  metadata: Record<string, unknown> | undefined,
): WorkspaceLike {
  return {
    id,
    name: id,
    activePaneId: "p",
    splitRoot: {
      type: "pane",
      pane: { id: "p", activeSurfaceId: "s", surfaces: [] },
    },
    ...(metadata ? { metadata } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("migrateLegacyProjectShapes — workspace metadata", () => {
  it("is a no-op on empty state", () => {
    const { changed } = migrateLegacyProjectShapes({});
    expect(changed).toBe(false);
  });

  it("rewrites projectId → groupId when groupId absent", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      workspaces: [makeWs("w1", { projectId: "grp-a" })],
    });
    expect(changed).toBe(true);
    expect(migrated.workspaces![0]!.metadata).toEqual({ groupId: "grp-a" });
  });

  it("prefers existing groupId when both projectId and groupId present", () => {
    const { migrated } = migrateLegacyProjectShapes({
      workspaces: [
        makeWs("w1", { projectId: "old", groupId: "already-migrated" }),
      ],
    });
    expect(migrated.workspaces![0]!.metadata).toEqual({
      groupId: "already-migrated",
    });
  });

  it("rewrites parentOrchestratorId → spawnedBy with kind='group' when groupId known", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      workspaces: [
        makeWs("w1", {
          groupId: "grp-a",
          parentOrchestratorId: "orch-legacy",
        }),
      ],
    });
    expect(changed).toBe(true);
    expect(migrated.workspaces![0]!.metadata).toEqual({
      groupId: "grp-a",
      spawnedBy: { kind: "group", groupId: "grp-a" },
    });
  });

  it("rewrites parentOrchestratorId → spawnedBy with kind='global' when no groupId", () => {
    const { migrated } = migrateLegacyProjectShapes({
      workspaces: [makeWs("w1", { parentOrchestratorId: "orch-root" })],
    });
    expect(migrated.workspaces![0]!.metadata).toEqual({
      spawnedBy: { kind: "global" },
    });
  });

  it("rewrites legacy orchestratorId + isDashboard → dashboardContributionId='agentic'", () => {
    const { migrated } = migrateLegacyProjectShapes({
      workspaces: [
        makeWs("w1", {
          isDashboard: true,
          orchestratorId: "orch-legacy",
        }),
      ],
    });
    expect(migrated.workspaces![0]!.metadata).toMatchObject({
      isDashboard: true,
      dashboardContributionId: "agentic",
    });
    // orchestratorId is dropped after rewrite.
    expect("orchestratorId" in (migrated.workspaces![0]!.metadata ?? {})).toBe(
      false,
    );
  });

  it("preserves spawnedBy when it's already present and drops the legacy parentOrchestratorId", () => {
    const existing = { kind: "group" as const, groupId: "grp-a" };
    const { migrated } = migrateLegacyProjectShapes({
      workspaces: [
        makeWs("w1", {
          groupId: "grp-a",
          parentOrchestratorId: "legacy",
          spawnedBy: existing,
        }),
      ],
    });
    expect(migrated.workspaces![0]!.metadata).toEqual({
      groupId: "grp-a",
      spawnedBy: existing,
    });
  });

  it("migrated state is idempotent — re-running produces no changes", () => {
    const pass1 = migrateLegacyProjectShapes({
      workspaces: [
        makeWs("w1", {
          projectId: "grp-a",
          parentOrchestratorId: "orch",
        }),
      ],
      rootRowOrder: [
        { kind: "project", id: "grp-a" },
        { kind: "agent-orchestrator", id: "orch" },
      ],
    });
    expect(pass1.changed).toBe(true);
    const pass2 = migrateLegacyProjectShapes(pass1.migrated);
    expect(pass2.changed).toBe(false);
  });
});

describe("migrateLegacyProjectShapes — rootRowOrder", () => {
  it("rewrites kind='project' → 'workspace-group'", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      rootRowOrder: [
        { kind: "project", id: "grp-a" },
        { kind: "workspace", id: "w1" },
      ],
    });
    expect(changed).toBe(true);
    expect(migrated.rootRowOrder).toEqual([
      { kind: "workspace-group", id: "grp-a" },
      { kind: "workspace", id: "w1" },
    ]);
  });

  it("drops kind='agent-orchestrator' entries entirely", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      rootRowOrder: [
        { kind: "agent-orchestrator", id: "orch" },
        { kind: "workspace", id: "w1" },
      ],
    });
    expect(changed).toBe(true);
    expect(migrated.rootRowOrder).toEqual([{ kind: "workspace", id: "w1" }]);
  });
});
