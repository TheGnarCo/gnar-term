import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../lib/config", () => ({
  getState: vi.fn(() => ({
    archivedOrder: [],
    archivedDefs: { workspaces: {}, groups: {} },
  })),
  saveState: vi.fn(() => Promise.resolve()),
}));

import {
  archivedOrder,
  archivedDefs,
  addToArchive,
  removeFromArchive,
  initArchiveFromState,
} from "../lib/stores/archive";
import { getState } from "../lib/config";

beforeEach(() => {
  vi.clearAllMocks();
  initArchiveFromState();
});

describe("addToArchive", () => {
  it("adds a workspace entry to archivedOrder and archivedDefs", () => {
    const def = {
      id: "ws-1",
      name: "My WS",
      layout: { pane: { surfaces: [] } },
    };
    addToArchive({ kind: "workspace", id: "ws-1" }, { def });
    expect(get(archivedOrder)).toEqual([{ kind: "workspace", id: "ws-1" }]);
    expect(get(archivedDefs).workspaces["ws-1"]).toEqual({ def });
  });

  it("adds a group entry to archivedOrder and archivedDefs", () => {
    const group = {
      id: "g-1",
      name: "My Group",
      path: "/foo",
      color: "blue",
      workspaceIds: [],
      isGit: false,
      createdAt: "2026-01-01",
    };
    addToArchive(
      { kind: "workspace-group", id: "g-1" },
      { group, workspaceDefs: [] },
    );
    expect(get(archivedOrder)).toEqual([
      { kind: "workspace-group", id: "g-1" },
    ]);
    expect(get(archivedDefs).groups["g-1"]?.group).toEqual(group);
  });

  it("does not add duplicate entries", () => {
    const def = { id: "ws-1", name: "W", layout: { pane: { surfaces: [] } } };
    addToArchive({ kind: "workspace", id: "ws-1" }, { def });
    addToArchive({ kind: "workspace", id: "ws-1" }, { def });
    expect(get(archivedOrder)).toHaveLength(1);
  });
});

describe("removeFromArchive", () => {
  it("removes a workspace entry from order and defs", () => {
    const def = { id: "ws-1", name: "W", layout: { pane: { surfaces: [] } } };
    addToArchive({ kind: "workspace", id: "ws-1" }, { def });
    removeFromArchive({ kind: "workspace", id: "ws-1" });
    expect(get(archivedOrder)).toHaveLength(0);
    expect(get(archivedDefs).workspaces["ws-1"]).toBeUndefined();
  });

  it("is a no-op for a missing entry", () => {
    removeFromArchive({ kind: "workspace", id: "nonexistent" });
    expect(get(archivedOrder)).toHaveLength(0);
  });
});

describe("initArchiveFromState", () => {
  it("seeds stores from persisted state", () => {
    vi.mocked(getState).mockReturnValueOnce({
      archivedOrder: [{ kind: "workspace", id: "ws-2" }],
      archivedDefs: {
        workspaces: {
          "ws-2": {
            def: {
              id: "ws-2",
              name: "Old WS",
              layout: { pane: { surfaces: [] } },
            },
          },
        },
        groups: {},
      },
    } as ReturnType<typeof getState>);
    initArchiveFromState();
    expect(get(archivedOrder)).toEqual([{ kind: "workspace", id: "ws-2" }]);
    expect(get(archivedDefs).workspaces["ws-2"]).toBeDefined();
  });
});
