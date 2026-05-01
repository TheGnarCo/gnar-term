/**
 * PTY spawn failure tests — verifies the contract between connectPty failing
 * and TerminalSurface.svelte showing an error + removing the dead surface.
 *
 * Follows the same contract-testing style as startup-command.test.ts:
 * drives the failure path through real connectPty, asserts on surface state,
 * and verifies the surface is removed from its pane (not persisted).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: class {
    onmessage: ((m: unknown) => void) | undefined = undefined;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    open = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    cols = 80;
    rows = 24;
    onData = vi.fn();
    onResize = vi.fn();
    onTitleChange = vi.fn();
    loadAddon = vi.fn();
    options: Record<string, unknown> = {};
    buffer = { active: { getLine: vi.fn() } };
    parser = { registerOscHandler: vi.fn() };
    attachCustomKeyEventHandler = vi.fn();
    registerLinkProvider = vi.fn();
    getSelection = vi.fn();
    hasSelection = vi.fn().mockReturnValue(false);
    onSelectionChange = vi.fn();
    scrollToBottom = vi.fn();
    clear = vi.fn();
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    activate = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
    onContextLoss = vi.fn();
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
    clearDecorations = vi.fn();
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../lib/config", () => ({
  saveState: vi.fn().mockResolvedValue(undefined),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  getConfig: vi.fn().mockReturnValue({ commands: [] }),
}));
vi.mock("../lib/services/service-helpers", () => ({
  safeFocus: vi.fn(),
  getActiveCwd: vi.fn().mockResolvedValue(undefined),
  getCwdForSurface: vi.fn().mockResolvedValue(undefined),
  registerPtyForSurface: vi.fn(),
  lookupTerminalByPtyId: vi.fn().mockReturnValue(null),
}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

import { invoke } from "@tauri-apps/api/core";
import { createTerminalSurface, connectPty } from "../lib/terminal-service";
import {
  closeSurfaceById,
  findSurfaceLocation,
} from "../lib/services/surface-service";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/nested-workspace";
import type { Pane, NestedWorkspace } from "../lib/types";
import { uid } from "../lib/types";

/** Set up a minimal workspace with a single pane in the store. */
function setupWorkspace(): { ws: NestedWorkspace; pane: Pane } {
  const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const ws: NestedWorkspace = {
    id: uid(),
    name: "Test WS",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
  nestedWorkspaces.set([ws]);
  activeNestedWorkspaceIdx.set(0);
  return { ws, pane };
}

describe("PTY spawn failure: connectPty sets spawnError", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    nestedWorkspaces.set([]);
  });

  it("sets surface.spawnError with the failure message when spawn_pty rejects", async () => {
    const { pane } = setupWorkspace();
    const surface = await createTerminalSurface(pane);

    vi.mocked(invoke).mockRejectedValueOnce(new Error("no shell found"));
    await connectPty(surface);

    expect(surface.ptyId).toBe(-1);
    expect(surface.spawnError).toBe("no shell found");
  });

  it("sets surface.spawnError with stringified non-Error rejection", async () => {
    const { pane } = setupWorkspace();
    const surface = await createTerminalSurface(pane);

    vi.mocked(invoke).mockRejectedValueOnce("permission denied");
    await connectPty(surface);

    expect(surface.ptyId).toBe(-1);
    expect(surface.spawnError).toBe("permission denied");
  });

  it("does NOT set spawnError on success", async () => {
    const { pane } = setupWorkspace();
    const surface = await createTerminalSurface(pane);

    vi.mocked(invoke).mockResolvedValueOnce(42);
    await connectPty(surface);

    expect(surface.ptyId).toBe(42);
    expect(surface.spawnError).toBeUndefined();
  });
});

describe("PTY spawn failure: surface cleanup via TerminalSurface contract", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    nestedWorkspaces.set([]);
  });

  it("surface is removed from pane after closeSurfaceById is called on spawn error", async () => {
    const { pane } = setupWorkspace();
    const surface = await createTerminalSurface(pane);

    // Pane has one surface after creation
    expect(pane.surfaces).toHaveLength(1);

    vi.mocked(invoke).mockRejectedValueOnce(new Error("spawn failed"));
    await connectPty(surface);

    expect(surface.spawnError).toBe("spawn failed");

    // Simulate what TerminalSurface.svelte does on spawnError:
    // find the pane containing this surface and close it.
    const loc = findSurfaceLocation(surface.id);
    expect(loc).not.toBeNull();
    expect(loc!.pane.id).toBe(pane.id);

    closeSurfaceById(loc!.pane.id, surface.id);

    // Surface is gone from the pane
    expect(
      get(nestedWorkspaces)[0]
        ? get(nestedWorkspaces)[0]!.splitRoot.type === "pane" &&
            (
              get(nestedWorkspaces)[0]!.splitRoot as {
                type: "pane";
                pane: Pane;
              }
            ).pane.surfaces.length
        : 0,
    ).toBe(0);
  });

  it("findSurfaceLocation returns null for a surface not in any workspace", async () => {
    const { pane } = setupWorkspace();
    const surface = await createTerminalSurface(pane);

    // Remove directly so the surface no longer exists in the store
    closeSurfaceById(pane.id, surface.id);

    // Now find should return null — prevents double-close
    const loc = findSurfaceLocation(surface.id);
    expect(loc).toBeNull();
  });

  it("spawnError is not set when connectPty is called on an already-connected surface", async () => {
    const { pane } = setupWorkspace();
    const surface = await createTerminalSurface(pane);

    vi.mocked(invoke).mockResolvedValueOnce(10);
    await connectPty(surface);
    expect(surface.ptyId).toBe(10);

    // Second call — already connected, should be a no-op
    await connectPty(surface);
    expect(surface.spawnError).toBeUndefined();
  });
});
