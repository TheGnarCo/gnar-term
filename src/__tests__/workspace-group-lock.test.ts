import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn().mockResolvedValue({}),
  saveExtensionState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/stores/root-row-order", () => ({
  appendRootRow: vi.fn(),
  removeRootRow: vi.fn(),
}));
vi.mock("../lib/services/claimed-workspace-registry", () => ({
  claimWorkspace: vi.fn(),
  unclaimWorkspace: vi.fn(),
}));
vi.mock("../lib/services/group-git-dirty-store", () => ({
  releaseGroupDirtyStore: vi.fn(),
}));
vi.mock("../lib/services/workspace-service", () => ({
  createWorkspaceFromDef: vi.fn(),
  closeWorkspace: vi.fn(),
}));
vi.mock("../lib/services/event-bus", () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

import {
  setWorkspaceGroups,
  getWorkspaceGroups,
} from "../lib/stores/workspace-groups";
import {
  toggleWorkspaceGroupLock,
  deleteWorkspaceGroup,
} from "../lib/services/workspace-group-service";
import { removeRootRow } from "../lib/stores/root-row-order";
import type { Workspace } from "../lib/config";

function makeGroup(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "g1",
    name: "Test Group",
    path: "/tmp/g1",
    color: "purple",
    workspaceIds: [],
    isGit: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("toggleWorkspaceGroupLock", () => {
  beforeEach(() => {
    setWorkspaceGroups([]);
  });

  it("sets locked to true on first toggle", () => {
    setWorkspaceGroups([makeGroup({ id: "g1" })]);
    toggleWorkspaceGroupLock("g1");
    expect(getWorkspaceGroups()[0].locked).toBe(true);
  });

  it("clears locked back to false on second toggle", () => {
    setWorkspaceGroups([makeGroup({ id: "g1", locked: true })]);
    toggleWorkspaceGroupLock("g1");
    expect(getWorkspaceGroups()[0].locked).toBe(false);
  });

  it("preserves other fields when toggling", () => {
    setWorkspaceGroups([
      makeGroup({ id: "g1", name: "Keep Me", color: "blue" }),
    ]);
    toggleWorkspaceGroupLock("g1");
    const g = getWorkspaceGroups()[0];
    expect(g.locked).toBe(true);
    expect(g.name).toBe("Keep Me");
    expect(g.color).toBe("blue");
  });

  it("only mutates the matching group", () => {
    setWorkspaceGroups([makeGroup({ id: "g1" }), makeGroup({ id: "g2" })]);
    toggleWorkspaceGroupLock("g2");
    expect(getWorkspaceGroups()[0].locked).toBeUndefined();
    expect(getWorkspaceGroups()[1].locked).toBe(true);
  });

  it("is a no-op for an unknown group id", () => {
    const g = makeGroup({ id: "g1" });
    setWorkspaceGroups([g]);
    toggleWorkspaceGroupLock("does-not-exist");
    expect(getWorkspaceGroups()[0]).toEqual(g);
  });
});

describe("deleteWorkspaceGroup — lock gate", () => {
  beforeEach(() => {
    setWorkspaceGroups([]);
    vi.mocked(removeRootRow).mockClear();
  });

  it("deletes an unlocked group normally", () => {
    setWorkspaceGroups([makeGroup({ id: "g1" })]);
    deleteWorkspaceGroup("g1");
    expect(getWorkspaceGroups()).toHaveLength(0);
    expect(removeRootRow).toHaveBeenCalledWith({
      kind: "workspace-group",
      id: "g1",
    });
  });

  it("is a no-op when group is locked", () => {
    setWorkspaceGroups([makeGroup({ id: "g1", locked: true })]);
    deleteWorkspaceGroup("g1");
    expect(getWorkspaceGroups()).toHaveLength(1);
    expect(removeRootRow).not.toHaveBeenCalled();
  });
});

describe("archiveGroup — lock gate (source audit)", () => {
  it("returns early when group is locked", () => {
    const src = readFileSync("src/lib/services/archive-service.ts", "utf-8");
    // Verify the lock gate appears in the archiveGroup function body
    expect(src).toContain("if (group.locked) return false");
  });
});
