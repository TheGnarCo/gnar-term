/**
 * Tests for session restore — round-trip a grouped workspace set through
 * persist → restore and confirm member arrays rebuild from tags, the row
 * order is preserved, and no out-of-scope (dashboard / ssh) data leaks in.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

let _stateFile: string | null = null;
const invokeMock = vi.fn(async (cmd: string, arg: any) => {
  if (cmd === "get_home") return "/home/test";
  if (cmd === "read_file") {
    if (arg?.path?.endsWith("state.json") && _stateFile !== null)
      return _stateFile;
    throw new Error("no file");
  }
  if (cmd === "write_file") {
    if (arg?.path?.endsWith("state.json")) _stateFile = arg.content;
    return undefined;
  }
  return undefined;
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => (invokeMock as any)(...args),
}));

// Lightweight terminal-surface stub — mirrors the real contract (push onto
// the pane, set activeSurfaceId) without spawning a PTY or an xterm instance.
let _surfaceSeq = 0;
vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(async (pane: any, cwd?: string) => {
    const surface = {
      kind: "terminal",
      id: `surf-${++_surfaceSeq}`,
      title: `Shell ${pane.surfaces.length + 1}`,
      cwd,
      hasUnread: false,
      opened: false,
      terminal: { focus: () => {} },
    };
    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    return surface;
  }),
}));
vi.mock("../preview/index", () => ({
  openPreview: vi.fn(),
}));

import { workspaces } from "../lib/stores/workspace";
import {
  workspaceOrder,
  setWorkspaceOrder,
  cancelOrderPersist,
} from "../lib/stores/workspace-order";
import { resetConfigStateForTests } from "../lib/config";
import { cancelPersist } from "../lib/services/workspace-persist";
import { initWorkspaces } from "../lib/services/init-workspaces";
import { teardownWorkspaceInit } from "../lib/services/init-workspaces";
import { sidebarVisible, groupCollapsedState } from "../lib/stores/ui";
import type { CliArgs } from "../lib/services/restore-workspaces";

const NO_CLI: CliArgs = {
  path: null,
  working_directory: null,
  command: null,
  title: null,
  workspace: null,
  config: null,
};

beforeEach(() => {
  cancelPersist();
  cancelOrderPersist();
  teardownWorkspaceInit();
  invokeMock.mockClear();
  _stateFile = null;
  _surfaceSeq = 0;
  resetConfigStateForTests();
  workspaces.set([]);
  setWorkspaceOrder([]);
  cancelOrderPersist();
  sidebarVisible.set(true);
  groupCollapsedState.set(new Map());
});

describe("restore round-trip", () => {
  it("rebuilds member arrays from tags and preserves row order", async () => {
    _stateFile = JSON.stringify({
      workspaces: [
        { id: "anchor", name: "Anchor", layout: { pane: { surfaces: [{ type: "terminal" }] } } },
        {
          id: "m1",
          name: "Member 1",
          anchorWorkspaceId: "anchor",
          layout: { pane: { surfaces: [{ type: "terminal" }] } },
        },
        {
          id: "m2",
          name: "Member 2",
          anchorWorkspaceId: "anchor",
          layout: { pane: { surfaces: [{ type: "terminal" }] } },
        },
        { id: "solo", name: "Solo", layout: { pane: { surfaces: [{ type: "terminal" }] } } },
      ],
      activeWorkspaceId: "solo",
      // Persisted order puts solo before the anchor.
      workspaceOrder: [
        { kind: "workspace", id: "solo" },
        { kind: "workspace", id: "anchor" },
      ],
      groupCollapsedById: { anchor: true },
      sidebarVisible: false,
    });

    await initWorkspaces(NO_CLI, {});

    const list = get(workspaces);
    // All four workspaces hydrate, ids preserved.
    expect(list.map((w) => w.id).sort()).toEqual([
      "anchor",
      "m1",
      "m2",
      "solo",
    ]);
    // Member arrays rebuilt from anchorWorkspaceId tags.
    expect(list.find((w) => w.id === "anchor")?.memberWorkspaceIds).toEqual([
      "m1",
      "m2",
    ]);
    // Members keep their back-reference tag.
    expect(list.find((w) => w.id === "m1")?.anchorWorkspaceId).toBe("anchor");

    // Only anchors get rows; persisted order preserved.
    expect(get(workspaceOrder).map((r) => r.id)).toEqual(["solo", "anchor"]);

    // Sidebar state restored.
    expect(get(sidebarVisible)).toBe(false);
    expect(get(groupCollapsedState).get("anchor")).toBe(true);
  });

  it("appends a row for a restored anchor missing from persisted order", async () => {
    _stateFile = JSON.stringify({
      workspaces: [
        { id: "a", name: "A", layout: { pane: { surfaces: [{ type: "terminal" }] } } },
        { id: "b", name: "B", layout: { pane: { surfaces: [{ type: "terminal" }] } } },
      ],
      workspaceOrder: [{ kind: "workspace", id: "a" }],
    });
    await initWorkspaces(NO_CLI, {});
    // b had no persisted row — bootstrap + reconcile append it.
    expect(get(workspaceOrder).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("auto-defaults a single workspace when state.json is absent", async () => {
    _stateFile = null;
    await initWorkspaces(NO_CLI, {});
    const list = get(workspaces);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("Workspace 1");
    expect(get(workspaceOrder).map((r) => r.id)).toEqual([list[0].id]);
  });

  it("stays empty when state.workspaces is an explicit empty array", async () => {
    _stateFile = JSON.stringify({ workspaces: [] });
    await initWorkspaces(NO_CLI, {});
    expect(get(workspaces).length).toBe(0);
  });

  it("never leaks dashboard/ssh data into restored workspaces", async () => {
    // Foreign dev-format fields planted on a persisted record; the scope cut
    // must strip them on restore. Defined once so the retired terms read as
    // legacy-format fixtures, not gnar-term vocabulary.
    const droppedDevFields: Record<string, unknown> = {
      isDashboard: true,
      controlled: true,
      rootWorkspaceId: "ghost",
    };
    _stateFile = JSON.stringify({
      workspaces: [
        {
          id: "a",
          name: "A",
          ...droppedDevFields,
          layout: { pane: { surfaces: [{ type: "terminal" }] } },
        },
      ],
    });
    await initWorkspaces(NO_CLI, {});
    const restored = get(workspaces)[0];
    const json = JSON.stringify(restored);
    for (const dropped of Object.keys(droppedDevFields)) {
      expect(json).not.toContain(dropped);
    }
  });
});
