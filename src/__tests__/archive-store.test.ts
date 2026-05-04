import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../lib/config", () => ({
  getState: vi.fn(() => ({
    archivedOrder: [],
    archivedDefs: { workspaces: {} },
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
import { getState, saveState } from "../lib/config";

beforeEach(() => {
  vi.clearAllMocks();
  initArchiveFromState();
});

function makeWorkspace(overrides = {}) {
  return {
    id: "g-1",
    name: "My Workspace",
    path: "/foo",
    color: "blue",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

describe("addToArchive", () => {
  it("adds an entry to archivedOrder and archivedDefs", () => {
    const workspace = makeWorkspace();
    addToArchive("g-1", { workspace, nestedWorkspaceDefs: [] });
    expect(get(archivedOrder)).toEqual(["g-1"]);
    expect(get(archivedDefs).workspaces["g-1"]?.workspace).toEqual(workspace);
  });

  it("does not add duplicate entries", () => {
    const workspace = makeWorkspace();
    addToArchive("g-1", { workspace, nestedWorkspaceDefs: [] });
    addToArchive("g-1", { workspace, nestedWorkspaceDefs: [] });
    expect(get(archivedOrder)).toHaveLength(1);
  });
});

describe("removeFromArchive", () => {
  it("removes an entry from order and defs", () => {
    const workspace = makeWorkspace();
    addToArchive("g-1", { workspace, nestedWorkspaceDefs: [] });
    removeFromArchive("g-1");
    expect(get(archivedOrder)).toHaveLength(0);
    expect(get(archivedDefs).workspaces["g-1"]).toBeUndefined();
  });

  it("is a no-op for a missing entry", () => {
    removeFromArchive("nonexistent");
    expect(get(archivedOrder)).toHaveLength(0);
  });
});

describe("initArchiveFromState", () => {
  it("seeds stores from persisted state", () => {
    const workspace = makeWorkspace({ id: "g-2", name: "Old WS" });
    vi.mocked(getState).mockReturnValueOnce({
      archivedOrder: ["g-2"],
      archivedDefs: {
        workspaces: {
          "g-2": { workspace, nestedWorkspaceDefs: [] },
        },
      },
    } as ReturnType<typeof getState>);
    initArchiveFromState();
    expect(get(archivedOrder)).toEqual(["g-2"]);
    expect(get(archivedDefs).workspaces["g-2"]).toBeDefined();
  });

  it("filters out malformed rows from persisted archivedOrder", () => {
    vi.mocked(getState).mockReturnValueOnce({
      archivedOrder: [
        "ok",
        42, // bad — not a string
        null,
        { kind: "workspace", id: "obj-not-string" },
        "ok-2",
      ] as unknown as string[],
      archivedDefs: { workspaces: {} },
    } as ReturnType<typeof getState>);
    initArchiveFromState();
    expect(get(archivedOrder)).toEqual(["ok", "ok-2"]);
  });
});

describe("persist", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls saveState after the debounce window when an item is added", async () => {
    const workspace = makeWorkspace();
    addToArchive("g-1", { workspace, nestedWorkspaceDefs: [] });

    // not yet — debounce hasn't fired
    expect(saveState).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(saveState).toHaveBeenCalledTimes(1);
    expect(saveState).toHaveBeenCalledWith(
      expect.objectContaining({
        archivedOrder: expect.any(Array),
        archivedDefs: expect.any(Object),
      }),
    );
    const call = vi.mocked(saveState).mock.calls[0]?.[0] as {
      archivedOrder: string[];
    };
    expect(call.archivedOrder).toEqual(["g-1"]);
  });

  it("calls saveState after debounce when an item is removed", async () => {
    const workspace = makeWorkspace();
    addToArchive("g-1", { workspace, nestedWorkspaceDefs: [] });
    await vi.runAllTimersAsync();
    vi.mocked(saveState).mockClear();

    removeFromArchive("g-1");
    expect(saveState).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(saveState).toHaveBeenCalledTimes(1);
    const call = vi.mocked(saveState).mock.calls[0]?.[0] as {
      archivedOrder: unknown[];
    };
    expect(call.archivedOrder).toEqual([]);
  });

  it("debounces — multiple rapid changes coalesce into one saveState call", async () => {
    const w1 = makeWorkspace({ id: "g-1" });
    const w2 = makeWorkspace({ id: "g-2" });
    addToArchive("g-1", { workspace: w1, nestedWorkspaceDefs: [] });
    addToArchive("g-2", { workspace: w2, nestedWorkspaceDefs: [] });
    removeFromArchive("g-1");

    await vi.runAllTimersAsync();

    expect(saveState).toHaveBeenCalledTimes(1);
  });
});
