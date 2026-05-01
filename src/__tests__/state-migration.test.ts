/**
 * Tests for the on-load AppState shape migration (paired with v1/v2
 * config migrations). Covers:
 *   - projectId → parentWorkspaceId on workspace metadata (Stage 2b)
 *   - parentOrchestratorId → spawnedBy (Stage 8)
 *   - orchestratorId + isDashboard → dashboardContributionId="agentic"
 *   - rootRowOrder of kind "project" → "workspace"
 *   - rootRowOrder of kind "workspace-group" → "workspace"
 *   - rootRowOrder of kind "workspace" with nested id → "nested-workspace"
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

type WorkspaceLike = NonNullable<AppState["nestedWorkspaces"]>[number];

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

  it("rewrites projectId → parentWorkspaceId when parentWorkspaceId absent", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      nestedWorkspaces: [makeWs("w1", { projectId: "grp-a" })],
    });
    expect(changed).toBe(true);
    expect(migrated.nestedWorkspaces![0]!.metadata).toEqual({
      parentWorkspaceId: "grp-a",
    });
  });

  it("prefers existing parentWorkspaceId when both projectId and parentWorkspaceId present", () => {
    const { migrated } = migrateLegacyProjectShapes({
      nestedWorkspaces: [
        makeWs("w1", {
          projectId: "old",
          parentWorkspaceId: "already-migrated",
        }),
      ],
    });
    expect(migrated.nestedWorkspaces![0]!.metadata).toEqual({
      parentWorkspaceId: "already-migrated",
    });
  });

  it("rewrites parentOrchestratorId → spawnedBy with kind='workspace' when parentWorkspaceId known", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      nestedWorkspaces: [
        makeWs("w1", {
          parentWorkspaceId: "grp-a",
          parentOrchestratorId: "orch-legacy",
        }),
      ],
    });
    expect(changed).toBe(true);
    expect(migrated.nestedWorkspaces![0]!.metadata).toEqual({
      parentWorkspaceId: "grp-a",
      spawnedBy: { kind: "workspace", parentWorkspaceId: "grp-a" },
    });
  });

  it("rewrites parentOrchestratorId → spawnedBy with kind='global' when no parentWorkspaceId", () => {
    const { migrated } = migrateLegacyProjectShapes({
      nestedWorkspaces: [makeWs("w1", { parentOrchestratorId: "orch-root" })],
    });
    expect(migrated.nestedWorkspaces![0]!.metadata).toEqual({
      spawnedBy: { kind: "global" },
    });
  });

  it("rewrites legacy orchestratorId + isDashboard → dashboardContributionId='agentic'", () => {
    const { migrated } = migrateLegacyProjectShapes({
      nestedWorkspaces: [
        makeWs("w1", {
          isDashboard: true,
          orchestratorId: "orch-legacy",
        }),
      ],
    });
    expect(migrated.nestedWorkspaces![0]!.metadata).toMatchObject({
      isDashboard: true,
      dashboardContributionId: "agentic",
    });
    // orchestratorId is dropped after rewrite.
    expect(
      "orchestratorId" in (migrated.nestedWorkspaces![0]!.metadata ?? {}),
    ).toBe(false);
  });

  it("preserves spawnedBy with kind='workspace' when already present and drops the legacy parentOrchestratorId", () => {
    const existing = {
      kind: "workspace" as const,
      parentWorkspaceId: "grp-a",
    };
    const { migrated } = migrateLegacyProjectShapes({
      nestedWorkspaces: [
        makeWs("w1", {
          parentWorkspaceId: "grp-a",
          parentOrchestratorId: "legacy",
          spawnedBy: existing,
        }),
      ],
    });
    expect(migrated.nestedWorkspaces![0]!.metadata).toEqual({
      parentWorkspaceId: "grp-a",
      spawnedBy: existing,
    });
  });

  it("rewrites legacy spawnedBy.kind='group' → 'workspace' (preserving parentWorkspaceId)", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      nestedWorkspaces: [
        makeWs("w1", {
          parentWorkspaceId: "grp-a",
          spawnedBy: { kind: "group", parentWorkspaceId: "grp-a" },
        }),
      ],
    });
    expect(changed).toBe(true);
    expect(migrated.nestedWorkspaces![0]!.metadata).toEqual({
      parentWorkspaceId: "grp-a",
      spawnedBy: { kind: "workspace", parentWorkspaceId: "grp-a" },
    });
  });

  it("rewrites legacy spawnedBy.kind='group' without parentWorkspaceId → kind='global'", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      nestedWorkspaces: [
        makeWs("w1", {
          spawnedBy: { kind: "group" },
        }),
      ],
    });
    expect(changed).toBe(true);
    expect(migrated.nestedWorkspaces![0]!.metadata).toEqual({
      spawnedBy: { kind: "global" },
    });
  });

  it("migrated state is idempotent — re-running produces no changes", () => {
    const pass1 = migrateLegacyProjectShapes({
      nestedWorkspaces: [
        makeWs("w1", {
          projectId: "grp-a",
          parentOrchestratorId: "orch",
        }),
      ],
      rootRowOrder: [
        { kind: "project", id: "grp-a" },
        { kind: "agent-orchestrator", id: "orch" },
        { kind: "workspace", id: "w1" },
      ],
    });
    expect(pass1.changed).toBe(true);
    const pass2 = migrateLegacyProjectShapes(pass1.migrated);
    expect(pass2.changed).toBe(false);
  });
});

describe("migrateLegacyProjectShapes — rootRowOrder", () => {
  it("rewrites kind='project' → 'workspace' (umbrella) and disambiguates legacy 'workspace' → 'nested-workspace' by id", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      nestedWorkspaces: [makeWs("w1", undefined)],
      rootRowOrder: [
        { kind: "project", id: "grp-a" },
        { kind: "workspace", id: "w1" },
      ],
    });
    expect(changed).toBe(true);
    expect(migrated.rootRowOrder).toEqual([
      { kind: "workspace", id: "grp-a" },
      { kind: "nested-workspace", id: "w1" },
    ]);
  });

  it("rewrites kind='workspace-group' → 'workspace' (intermediate persisted shape)", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      nestedWorkspaces: [makeWs("w1", undefined)],
      rootRowOrder: [
        { kind: "workspace-group", id: "grp-a" },
        { kind: "workspace", id: "w1" },
      ],
    });
    expect(changed).toBe(true);
    expect(migrated.rootRowOrder).toEqual([
      { kind: "workspace", id: "grp-a" },
      { kind: "nested-workspace", id: "w1" },
    ]);
  });

  it("leaves 'workspace' rows alone when their id is NOT a known nested workspace", () => {
    // No nestedWorkspaces in state — the "workspace" row must be an
    // umbrella block, so it stays as-is.
    const { migrated, changed } = migrateLegacyProjectShapes({
      rootRowOrder: [{ kind: "workspace", id: "grp-a" }],
    });
    expect(changed).toBe(false);
    expect(migrated.rootRowOrder).toEqual([{ kind: "workspace", id: "grp-a" }]);
  });

  it("drops kind='agent-orchestrator' entries entirely", () => {
    const { migrated, changed } = migrateLegacyProjectShapes({
      nestedWorkspaces: [makeWs("w1", undefined)],
      rootRowOrder: [
        { kind: "agent-orchestrator", id: "orch" },
        { kind: "workspace", id: "w1" },
      ],
    });
    expect(changed).toBe(true);
    expect(migrated.rootRowOrder).toEqual([
      { kind: "nested-workspace", id: "w1" },
    ]);
  });

  it("is idempotent — already-renamed shape passes through unchanged", () => {
    const { changed } = migrateLegacyProjectShapes({
      nestedWorkspaces: [makeWs("w1", undefined)],
      rootRowOrder: [
        { kind: "workspace", id: "grp-a" },
        { kind: "nested-workspace", id: "w1" },
      ],
    });
    expect(changed).toBe(false);
  });
});
