/**
 * Tests for the pty-notification → desktop notification bridge in
 * terminal-service.ts. The bridge:
 *   - Updates surface.notification + surface.hasUnread (existing behavior)
 *   - Fires a desktop notification UNLESS the affected surface is the
 *     foreground surface in the foreground pane of the foreground
 *     workspace (no point notifying about something the user is staring at)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => {
  const handlers = new Map<string, (event: unknown) => void>();
  return {
    listen: vi.fn(async (name: string, handler: (event: unknown) => void) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    }),
    __handlers: handlers,
  };
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));

import * as eventModule from "@tauri-apps/api/event";
import * as notifModule from "@tauri-apps/plugin-notification";
import { setupListeners } from "../lib/terminal-service";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/nested-workspace";
import type { NestedWorkspace, TerminalSurface } from "../lib/types";

function makeTerminalSurface(id: string, ptyId: number): TerminalSurface {
  return {
    kind: "terminal",
    id,
    title: id,
    cwd: "/tmp",
    ptyId,
    hasUnread: false,
    opened: false,
    terminal: { options: {} } as unknown as TerminalSurface["terminal"],
    fitAddon: { fit: vi.fn() } as unknown as TerminalSurface["fitAddon"],
    searchAddon: {} as unknown as TerminalSurface["searchAddon"],
    termElement: document.createElement("div"),
  } as TerminalSurface;
}

function makeWorkspaceWith(
  id: string,
  surface: TerminalSurface,
  activeSurfaceId?: string,
): NestedWorkspace {
  return {
    id,
    name: id,
    splitRoot: {
      type: "pane",
      pane: {
        id: `${id}-p`,
        surfaces: [surface],
        activeSurfaceId: activeSurfaceId ?? surface.id,
      },
    },
    activePaneId: `${id}-p`,
  };
}

const handlers = (
  eventModule as unknown as {
    __handlers: Map<string, (event: unknown) => void>;
  }
).__handlers;

describe("pty-notification → desktop notification", () => {
  beforeEach(async () => {
    vi.mocked(notifModule.sendNotification).mockClear();
    handlers.clear();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    await setupListeners();
  });

  function dispatchPtyNotification(ptyId: number, text: string) {
    const handler = handlers.get("pty-notification");
    if (!handler) throw new Error("pty-notification handler not registered");
    handler({ payload: { pty_id: ptyId, text } });
  }

  it("fires a desktop notification when the surface is in a non-active workspace", async () => {
    const fgSurface = makeTerminalSurface("fg", 1);
    const bgSurface = makeTerminalSurface("bg", 2);
    nestedWorkspaces.set([
      makeWorkspaceWith("ws-fg", fgSurface),
      makeWorkspaceWith("ws-bg", bgSurface),
    ]);
    activeNestedWorkspaceIdx.set(0);

    dispatchPtyNotification(2, "build complete");
    // Allow the async fire-and-forget desktop notification path to settle
    await Promise.resolve();
    await Promise.resolve();

    expect(notifModule.sendNotification).toHaveBeenCalledTimes(1);
    expect(notifModule.sendNotification).toHaveBeenCalledWith({
      title: "ws-bg",
      body: "build complete",
    });
    expect(bgSurface.hasUnread).toBe(true);
    expect(bgSurface.notification).toBe("build complete");
  });

  it("suppresses the desktop notification when the surface is the active surface in the active pane of the active workspace", async () => {
    const fgSurface = makeTerminalSurface("fg", 1);
    nestedWorkspaces.set([makeWorkspaceWith("ws-fg", fgSurface)]);
    activeNestedWorkspaceIdx.set(0);

    dispatchPtyNotification(1, "tests passed");
    await Promise.resolve();
    await Promise.resolve();

    expect(notifModule.sendNotification).not.toHaveBeenCalled();
    // hasUnread is still set — pane border + tab dot should still light up
    // even though the desktop notification is suppressed
    expect(fgSurface.hasUnread).toBe(true);
    expect(fgSurface.notification).toBe("tests passed");
  });

  it("ignores events that look like escape-sequence fragments", async () => {
    const surface = makeTerminalSurface("s", 1);
    nestedWorkspaces.set([makeWorkspaceWith("ws", surface)]);
    activeNestedWorkspaceIdx.set(0);

    dispatchPtyNotification(1, "4;0;");
    await Promise.resolve();

    expect(notifModule.sendNotification).not.toHaveBeenCalled();
    expect(surface.hasUnread).toBe(false);
  });
});
