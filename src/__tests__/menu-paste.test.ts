/**
 * Menu paste router tests — the Edit > Paste menu item emits `menu-paste` and
 * the router pastes by focus. The key behavior: a focused terminal receives
 * `terminal.paste(text)` (which applies xterm's bracketed-paste wrapping) so
 * multiline pastes into TUIs like Claude Code arrive as one block instead of
 * submitting on the first newline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const clip = vi.hoisted(() => ({ text: "line1\nline2" }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(async () => clip.text),
}));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import type { Workspace, Pane, TerminalSurface } from "../lib/types";
import { handleMenuPaste } from "../lib/services/menu-paste-router";

function makeTerminalSurface(termElement: HTMLElement): TerminalSurface {
  return {
    kind: "terminal",
    id: "s1",
    terminal: { paste: vi.fn() } as any,
    fitAddon: {} as any,
    searchAddon: {} as any,
    termElement,
    ptyId: 7,
    title: "shell",
    hasUnread: false,
    opened: true,
  };
}

function setWorkspace(surface: TerminalSurface) {
  const pane: Pane = {
    id: "p1",
    surfaces: [surface],
    activeSurfaceId: surface.id,
  };
  const ws: Workspace = {
    id: "ws1",
    name: "ws",
    splitRoot: { type: "pane", pane },
    activePaneId: "p1",
  };
  workspaces.set([ws]);
  activeWorkspaceIdx.set(0);
}

describe("handleMenuPaste", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    clip.text = "line1\nline2";
  });

  it("pastes into the focused terminal via terminal.paste (bracketed)", async () => {
    // xterm's helper textarea lives inside termElement; focusing it means the
    // active element is contained by the surface.
    const termEl = document.createElement("div");
    const helper = document.createElement("textarea");
    termEl.appendChild(helper);
    document.body.appendChild(termEl);
    const surface = makeTerminalSurface(termEl);
    setWorkspace(surface);
    helper.focus();

    await handleMenuPaste();

    expect(surface.terminal.paste).toHaveBeenCalledWith("line1\nline2");
  });

  it("does not paste when the terminal is disconnected (ptyId < 0)", async () => {
    const termEl = document.createElement("div");
    const helper = document.createElement("textarea");
    termEl.appendChild(helper);
    document.body.appendChild(termEl);
    const surface = makeTerminalSurface(termEl);
    surface.ptyId = -1;
    setWorkspace(surface);
    helper.focus();

    await handleMenuPaste();

    expect(surface.terminal.paste).not.toHaveBeenCalled();
  });

  it("splices into a focused textarea (not a terminal), preserving newlines", async () => {
    const termEl = document.createElement("div");
    document.body.appendChild(termEl);
    setWorkspace(makeTerminalSurface(termEl));

    const input = document.createElement("textarea");
    input.value = "ab";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(1, 1); // cursor between a|b

    await handleMenuPaste();

    expect(input.value).toBe("aline1\nline2b");
  });

  it("is a no-op when the clipboard is empty", async () => {
    clip.text = "";
    const termEl = document.createElement("div");
    const helper = document.createElement("textarea");
    termEl.appendChild(helper);
    document.body.appendChild(termEl);
    const surface = makeTerminalSurface(termEl);
    setWorkspace(surface);
    helper.focus();

    await handleMenuPaste();

    expect(surface.terminal.paste).not.toHaveBeenCalled();
  });
});
