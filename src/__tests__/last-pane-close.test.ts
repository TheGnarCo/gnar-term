/**
 * Tests for the last-pane-close back-edge in pane-service (RESOLVED:
 * promote-first-member-to-anchor). Closing an anchor's last pane:
 *   - anchor WITH members → first member becomes the new anchor, inherits the
 *     row position, remaining members retag to it
 *   - anchor with NO members → the group/workspace just vanishes
 *   - very-last workspace overall → spawn a fresh standalone
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === "get_home") return "/home/test";
  if (cmd === "read_file") throw new Error("no file");
  return undefined;
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => (invokeMock as any)(...args),
}));

let _surfaceSeq = 0;
vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(async (pane: any, cwd?: string) => {
    const surface = {
      kind: "terminal",
      id: `surf-${++_surfaceSeq}`,
      title: "Shell",
      cwd,
      hasUnread: false,
      opened: false,
      terminal: { focus: () => {}, dispose: () => {} },
      ptyId: -1,
    };
    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    return surface;
  }),
}));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  workspaceOrder,
  setWorkspaceOrder,
  cancelOrderPersist,
} from "../lib/stores/workspace-order";
import { cancelPersist } from "../lib/services/workspace-persist";
import { removePane } from "../lib/services/pane-service";
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

const orderIds = () => get(workspaceOrder).map((r) => r.id);

beforeEach(() => {
  cancelPersist();
  cancelOrderPersist();
  _surfaceSeq = 0;
  workspaces.set([]);
  setWorkspaceOrder([]);
  cancelOrderPersist();
  activeWorkspaceIdx.set(0);
});

describe("last-pane-close back-edge", () => {
  it("anchor WITH members: promotes the first member, keeps the row slot", () => {
    const anchor = ws("anchor", { memberWorkspaceIds: ["m1", "m2"] });
    const m1 = ws("m1", { anchorWorkspaceId: "anchor" });
    const m2 = ws("m2", { anchorWorkspaceId: "anchor" });
    const after = ws("after");
    workspaces.set([anchor, m1, m2, after]);
    setWorkspaceOrder([
      { kind: "workspace", id: "anchor" },
      { kind: "workspace", id: "after" },
    ]);
    cancelOrderPersist();

    // Close the anchor's only (root) pane.
    removePane(anchor, anchor.splitRoot.type === "pane" ? anchor.splitRoot.pane : (null as any));

    const list = get(workspaces);
    expect(list.find((w) => w.id === "anchor")).toBeUndefined();
    const newAnchor = list.find((w) => w.id === "m1")!;
    expect(newAnchor.anchorWorkspaceId).toBeUndefined();
    expect(newAnchor.memberWorkspaceIds).toEqual(["m2"]);
    expect(list.find((w) => w.id === "m2")?.anchorWorkspaceId).toBe("m1");
    // The promoted member inherits the closed anchor's row position.
    expect(orderIds()).toEqual(["m1", "after"]);
  });

  it("anchor with NO members: the workspace vanishes, no fresh spawn", () => {
    const anchor = ws("anchor");
    const other = ws("other");
    workspaces.set([anchor, other]);
    setWorkspaceOrder([
      { kind: "workspace", id: "anchor" },
      { kind: "workspace", id: "other" },
    ]);
    cancelOrderPersist();

    removePane(anchor, anchor.splitRoot.type === "pane" ? anchor.splitRoot.pane : (null as any));

    const list = get(workspaces);
    expect(list.map((w) => w.id)).toEqual(["other"]);
    expect(orderIds()).toEqual(["other"]);
  });

  it("very-last workspace: spawns a fresh standalone", async () => {
    const only = ws("only");
    workspaces.set([only]);
    setWorkspaceOrder([{ kind: "workspace", id: "only" }]);
    cancelOrderPersist();

    removePane(only, only.splitRoot.type === "pane" ? only.splitRoot.pane : (null as any));
    // createWorkspace("Workspace 1") is async (awaits createTerminalSurface);
    // let its microtasks settle before asserting.
    await vi.waitFor(() => expect(get(workspaces).length).toBe(1));

    const list = get(workspaces);
    expect(list.length).toBe(1);
    expect(list[0].id).not.toBe("only");
    expect(list[0].name).toBe("Workspace 1");
    // The fresh standalone owns a row; the closed one's row is gone.
    expect(orderIds()).toEqual([list[0].id]);
  });

  it("closing a member detaches it from its anchor's ordered list", () => {
    const anchor = ws("anchor", { memberWorkspaceIds: ["m1", "m2"] });
    const m1 = ws("m1", { anchorWorkspaceId: "anchor" });
    const m2 = ws("m2", { anchorWorkspaceId: "anchor" });
    workspaces.set([anchor, m1, m2]);
    setWorkspaceOrder([{ kind: "workspace", id: "anchor" }]);
    cancelOrderPersist();

    removePane(m1, m1.splitRoot.type === "pane" ? m1.splitRoot.pane : (null as any));

    const list = get(workspaces);
    expect(list.find((w) => w.id === "m1")).toBeUndefined();
    expect(list.find((w) => w.id === "anchor")?.memberWorkspaceIds).toEqual([
      "m2",
    ]);
    // Members never owned a row; the anchor's row is untouched.
    expect(orderIds()).toEqual(["anchor"]);
  });
});
