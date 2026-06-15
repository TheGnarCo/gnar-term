/**
 * Desktop-notification focus suppression — a terminal attention notification
 * fires only when the user is NOT already looking at that surface. The
 * foreground check keys off the active workspace + active pane + active
 * surface, all on the splitRoot pane model.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));

import type {
  Workspace,
  Pane,
  Surface,
  SplitNode,
  TerminalSurface,
} from "../lib/types";
import { isSurfaceInForeground } from "../lib/terminal-service";

function term(id: string): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: {} as any,
    fitAddon: {} as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId: 1,
    title: id,
    hasUnread: false,
    opened: true,
  };
}

function pane(id: string, surfaces: Surface[], activeSurfaceId: string): Pane {
  return { id, surfaces, activeSurfaceId };
}

// Workspace: split of p1 (active, showing s1; s2 hidden) | p2 (showing s3).
function makeWs(id: string, activePaneId: string): Workspace {
  const splitRoot: SplitNode = {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { type: "pane", pane: pane("p1", [term("s1"), term("s2")], "s1") },
      { type: "pane", pane: pane("p2", [term("s3")], "s3") },
    ],
  };
  return { id, name: id, splitRoot, activePaneId };
}

describe("isSurfaceInForeground", () => {
  it("true: active surface in the active pane of the active workspace", () => {
    const ws = makeWs("ws1", "p1");
    expect(isSurfaceInForeground(ws, ws, "s1")).toBe(true);
  });

  it("false: surface is in the active pane but not its active tab", () => {
    const ws = makeWs("ws1", "p1");
    expect(isSurfaceInForeground(ws, ws, "s2")).toBe(false);
  });

  it("false: surface is the active tab of a non-focused pane", () => {
    const ws = makeWs("ws1", "p1"); // p1 focused, so p2's s3 is background
    expect(isSurfaceInForeground(ws, ws, "s3")).toBe(false);
  });

  it("false: workspace is not the active workspace", () => {
    const ws = makeWs("ws1", "p1");
    const otherActive = makeWs("ws2", "p1");
    expect(isSurfaceInForeground(ws, otherActive, "s1")).toBe(false);
  });

  it("false: no active workspace at all", () => {
    const ws = makeWs("ws1", "p1");
    expect(isSurfaceInForeground(ws, null, "s1")).toBe(false);
  });
});
