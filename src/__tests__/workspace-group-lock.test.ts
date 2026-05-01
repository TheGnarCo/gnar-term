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
vi.mock("../lib/services/workspace-git-dirty-store", () => ({
  releaseWorkspaceDirtyStore: vi.fn(),
}));
vi.mock("../lib/services/workspace-service", () => ({
  createNestedWorkspaceFromDef: vi.fn(),
  closeNestedWorkspace: vi.fn(),
}));
vi.mock("../lib/services/event-bus", () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

import { setWorkspaces, getWorkspaces } from "../lib/stores/workspace-groups";
import {
  toggleWorkspaceLock,
  deleteWorkspace,
} from "../lib/services/workspace-group-service";
import { removeRootRow } from "../lib/stores/root-row-order";
import type { Workspace } from "../lib/config";

function makeGroup(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "g1",
    name: "Test Group",
    path: "/tmp/g1",
    color: "purple",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("toggleWorkspaceLock", () => {
  beforeEach(() => {
    setWorkspaces([]);
  });

  it("sets locked to true on first toggle", () => {
    setWorkspaces([makeGroup({ id: "g1" })]);
    toggleWorkspaceLock("g1");
    expect(getWorkspaces()[0].locked).toBe(true);
  });

  it("clears locked back to false on second toggle", () => {
    setWorkspaces([makeGroup({ id: "g1", locked: true })]);
    toggleWorkspaceLock("g1");
    expect(getWorkspaces()[0].locked).toBe(false);
  });

  it("preserves other fields when toggling", () => {
    setWorkspaces([makeGroup({ id: "g1", name: "Keep Me", color: "blue" })]);
    toggleWorkspaceLock("g1");
    const g = getWorkspaces()[0];
    expect(g.locked).toBe(true);
    expect(g.name).toBe("Keep Me");
    expect(g.color).toBe("blue");
  });

  it("only mutates the matching group", () => {
    setWorkspaces([makeGroup({ id: "g1" }), makeGroup({ id: "g2" })]);
    toggleWorkspaceLock("g2");
    expect(getWorkspaces()[0].locked).toBeUndefined();
    expect(getWorkspaces()[1].locked).toBe(true);
  });

  it("is a no-op for an unknown group id", () => {
    const g = makeGroup({ id: "g1" });
    setWorkspaces([g]);
    toggleWorkspaceLock("does-not-exist");
    expect(getWorkspaces()[0]).toEqual(g);
  });
});

describe("deleteWorkspace — lock gate", () => {
  beforeEach(() => {
    setWorkspaces([]);
    vi.mocked(removeRootRow).mockClear();
  });

  it("deletes an unlocked group normally", () => {
    setWorkspaces([makeGroup({ id: "g1" })]);
    deleteWorkspace("g1");
    expect(getWorkspaces()).toHaveLength(0);
    expect(removeRootRow).toHaveBeenCalledWith({
      kind: "workspace-group",
      id: "g1",
    });
  });

  it("is a no-op when group is locked", () => {
    setWorkspaces([makeGroup({ id: "g1", locked: true })]);
    deleteWorkspace("g1");
    expect(getWorkspaces()).toHaveLength(1);
    expect(removeRootRow).not.toHaveBeenCalled();
  });
});

describe("archiveWorkspace — lock gate (source audit)", () => {
  it("returns early when group is locked", () => {
    const src = readFileSync("src/lib/services/archive-service.ts", "utf-8");
    // Verify the lock gate appears in the archiveWorkspace function body
    expect(src).toContain("if (group.locked) return false");
  });
});
