/**
 * Tests for the live state.json persistence layer.
 *
 *   - mutating workspaces schedules a debounced write
 *   - the order store schedules a debounced write
 *   - sidebar-visible + group-collapsed persist on change (skip-first-emission)
 *   - legacy dev-format keys (rootRowOrder / bannerCollapsedById) are read
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  loadState,
  saveState,
  getState,
  resetConfigStateForTests,
  appStateStore,
  type AppState,
} from "../lib/config";
import { workspaces } from "../lib/stores/workspace";
import {
  appendWorkspaceRow,
  setWorkspaceOrder,
  cancelOrderPersist,
} from "../lib/stores/workspace-order";
import {
  schedulePersist,
  cancelPersist,
  persistWorkspaces,
} from "../lib/services/workspace-persist";
import { sidebarVisible, groupCollapsedState, setGroupCollapsed } from "../lib/stores/ui";
import {
  restoreSidebarVisible,
  restoreGroupCollapsed,
  persistSidebarVisibleChanges,
  persistGroupCollapsedChanges,
} from "../lib/services/sidebar-persistence-service";
import type { Workspace, Pane } from "../lib/types";

function ws(id: string, extra: Partial<Workspace> = {}): Workspace {
  const pane: Pane = { id: `${id}-p`, surfaces: [], activeSurfaceId: null };
  return {
    id,
    name: id,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    ...extra,
  };
}

/** Return the parsed payload of the last state.json write_file invoke. */
function lastWrittenState(): AppState | null {
  for (let i = invokeMock.mock.calls.length - 1; i >= 0; i--) {
    const [cmd, arg] = invokeMock.mock.calls[i] as [string, any];
    if (cmd === "write_file" && arg?.path?.endsWith("state.json")) {
      return JSON.parse(arg.content) as AppState;
    }
  }
  return null;
}

beforeEach(() => {
  cancelPersist();
  cancelOrderPersist();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    if (cmd === "read_file") throw new Error("no file");
    return undefined;
  });
  resetConfigStateForTests();
  workspaces.set([]);
  setWorkspaceOrder([]);
  cancelOrderPersist();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("workspace persist", () => {
  it("persistWorkspaces writes serialized workspaces + active id", async () => {
    workspaces.set([ws("a"), ws("m", { anchorWorkspaceId: "a" })]);
    await persistWorkspaces();
    const written = lastWrittenState();
    expect(written?.workspaces?.map((w) => w.id)).toEqual(["a", "m"]);
    expect(
      written?.workspaces?.find((w) => w.id === "m")?.anchorWorkspaceId,
    ).toBe("a");
  });

  it("schedulePersist debounces to a single trailing write", async () => {
    vi.useFakeTimers();
    workspaces.set([ws("a")]);
    schedulePersist();
    schedulePersist();
    schedulePersist();
    expect(lastWrittenState()).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(lastWrittenState()?.workspaces?.map((w) => w.id)).toEqual(["a"]);
    const writes = invokeMock.mock.calls.filter(
      ([cmd, arg]) =>
        cmd === "write_file" && (arg as any)?.path?.endsWith("state.json"),
    );
    expect(writes.length).toBe(1);
  });
});

describe("order persist", () => {
  it("schedules a debounced write of the row order", async () => {
    vi.useFakeTimers();
    appendWorkspaceRow({ kind: "workspace", id: "a" });
    expect(lastWrittenState()).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(lastWrittenState()?.workspaceOrder?.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("sidebar persistence", () => {
  it("persists sidebarVisible toggles, skipping the restored first emission", () => {
    restoreSidebarVisible({ sidebarVisible: false });
    expect(get(sidebarVisible)).toBe(false);

    const unsub = persistSidebarVisibleChanges();
    // First (restored) emission is skipped — no write yet.
    expect(getState().sidebarVisible).toBeUndefined();

    sidebarVisible.set(true);
    expect(getState().sidebarVisible).toBe(true);
    unsub();
  });

  it("persists group-collapsed changes, skipping the restored first emission", () => {
    restoreGroupCollapsed({ groupCollapsedById: { g1: true } });
    expect(get(groupCollapsedState).get("g1")).toBe(true);

    const unsub = persistGroupCollapsedChanges();
    expect(getState().groupCollapsedById).toBeUndefined();

    setGroupCollapsed("g2", false);
    expect(getState().groupCollapsedById).toEqual({ g1: true, g2: false });
    unsub();
  });
});

describe("legacy-key reads", () => {
  it("normalizes rootRowOrder → workspaceOrder and bannerCollapsedById → groupCollapsedById", async () => {
    invokeMock.mockImplementation(async (cmd: string, arg: any) => {
      if (cmd === "get_home") return "/home/test";
      if (cmd === "read_file" && arg?.path?.endsWith("state.json")) {
        return JSON.stringify({
          rootRowOrder: [{ kind: "workspace", id: "legacy" }],
          bannerCollapsedById: { g1: true },
        });
      }
      throw new Error("no file");
    });

    const state = await loadState();
    expect(state.workspaceOrder).toEqual([{ kind: "workspace", id: "legacy" }]);
    expect(state.groupCollapsedById).toEqual({ g1: true });
    // Legacy aliases are stripped after normalization.
    expect(state.rootRowOrder).toBeUndefined();
    expect(state.bannerCollapsedById).toBeUndefined();
    // The reactive store mirrors the normalized state.
    expect(get(appStateStore).workspaceOrder).toEqual([
      { kind: "workspace", id: "legacy" },
    ]);
  });

  it("prefers the canonical key when both are present", async () => {
    invokeMock.mockImplementation(async (cmd: string, arg: any) => {
      if (cmd === "get_home") return "/home/test";
      if (cmd === "read_file" && arg?.path?.endsWith("state.json")) {
        return JSON.stringify({
          workspaceOrder: [{ kind: "workspace", id: "new" }],
          rootRowOrder: [{ kind: "workspace", id: "old" }],
        });
      }
      throw new Error("no file");
    });
    const state = await loadState();
    expect(state.workspaceOrder).toEqual([{ kind: "workspace", id: "new" }]);
  });

  it("never writes legacy aliases back to disk", async () => {
    await saveState({
      workspaceOrder: [{ kind: "workspace", id: "x" }],
    });
    const written = lastWrittenState();
    expect(written).not.toBeNull();
    const json = JSON.stringify(written);
    expect(json).not.toContain("rootRowOrder");
    expect(json).not.toContain("bannerCollapsedById");
  });
});
