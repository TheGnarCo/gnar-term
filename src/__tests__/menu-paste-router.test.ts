/**
 * Tests for the menu-paste router. The native Edit > Paste accelerator
 * preempts the in-terminal keydown handler, so paste must route through
 * this dispatcher to preserve xterm bracketed-paste wrapping for TUIs
 * (Claude Code, vim) while still working in DOM inputs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const clipboardText = vi.fn<[], Promise<string>>();

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: () => clipboardText(),
}));

const workspacesValue: Array<{ paneLayout: unknown }> = [];
vi.mock("../lib/stores/workspace", () => ({
  workspaces: { subscribe: vi.fn() },
}));
vi.mock("svelte/store", async () => {
  const actual =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  return { ...actual, get: () => workspacesValue };
});

import { handleMenuPaste } from "../lib/services/menu-paste-router";

function makeTerminalSurface(termElement: HTMLElement, ptyId = 1) {
  const paste = vi.fn();
  return {
    paste,
    surface: {
      kind: "terminal" as const,
      id: "s1",
      terminal: { paste } as unknown as { paste: typeof paste },
      fitAddon: {} as never,
      searchAddon: {} as never,
      termElement,
      ptyId,
      title: "t",
      hasUnread: false,
      opened: true,
    },
  };
}

function setActiveLayout(surfaces: unknown[]) {
  workspacesValue.length = 0;
  workspacesValue.push({
    paneLayout: {
      type: "pane",
      pane: { id: "p1", surfaces, activeSurfaceId: null },
    },
  });
}

function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

beforeEach(() => {
  clearBody();
  workspacesValue.length = 0;
  clipboardText.mockResolvedValue("hello world");
});

describe("handleMenuPaste", () => {
  it("routes to terminal.paste() when focus is inside a terminal surface", async () => {
    const termEl = document.createElement("div");
    const innerXterm = document.createElement("textarea");
    termEl.appendChild(innerXterm);
    document.body.appendChild(termEl);
    const { paste, surface } = makeTerminalSurface(termEl);
    setActiveLayout([surface]);

    innerXterm.focus();
    await handleMenuPaste();

    expect(paste).toHaveBeenCalledWith("hello world");
  });

  it("does not paste when terminal ptyId is -1 (unspawned)", async () => {
    const termEl = document.createElement("div");
    document.body.appendChild(termEl);
    const { paste, surface } = makeTerminalSurface(termEl, -1);
    setActiveLayout([surface]);
    termEl.tabIndex = -1;
    termEl.focus();

    await handleMenuPaste();
    expect(paste).not.toHaveBeenCalled();
  });

  it("splices text into a focused HTML input at the selection", async () => {
    const input = document.createElement("input");
    input.value = "abcdef";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(2, 4); // select "cd"

    const handler = vi.fn();
    input.addEventListener("input", handler);

    await handleMenuPaste();

    expect(input.value).toBe("ab" + "hello world" + "ef");
    expect(handler).toHaveBeenCalled();
  });

  it("splices text into a focused textarea at the selection", async () => {
    const ta = document.createElement("textarea");
    ta.value = "12345";
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(5, 5);

    await handleMenuPaste();
    expect(ta.value).toBe("12345hello world");
  });

  it("delegates to execCommand for contenteditable", async () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    div.tabIndex = 0;
    document.body.appendChild(div);
    div.focus();
    expect(document.activeElement).toBe(div);

    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: exec,
    });

    await handleMenuPaste();
    expect(exec).toHaveBeenCalledWith("insertText", false, "hello world");
  });

  it("is a no-op when clipboard is empty", async () => {
    clipboardText.mockResolvedValueOnce("");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const handler = vi.fn();
    input.addEventListener("input", handler);

    await handleMenuPaste();
    expect(handler).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("swallows clipboard errors without throwing", async () => {
    clipboardText.mockRejectedValueOnce(new Error("denied"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(handleMenuPaste()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
