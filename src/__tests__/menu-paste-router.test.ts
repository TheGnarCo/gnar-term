/**
 * Tests for the menu-paste router. The native Edit > Paste accelerator
 * preempts the in-terminal keydown handler, so paste must route through
 * this dispatcher to preserve bracketed-paste wrapping for TUIs
 * (Claude Code, vim) while still working in DOM inputs.
 *
 * After the alacritty cutover the router:
 *   - Finds the PTY ID from `data-pty-id` on a canvas ancestor
 *   - Encodes via PasteHandler.encodePaste() (bracketed paste)
 *   - Calls write_pty via Tauri invoke
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const clipboardText = vi.fn<[], Promise<string>>();

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: () => clipboardText(),
}));

const invokeWritePty = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeWritePty(...args),
}));

// PasteHandler.encodePaste is tested separately; here we just want to verify
// the routing call is made with the encoded string.
vi.mock("../lib/components/alacritty/paste-handler", () => ({
  PasteHandler: class {
    encodePaste(text: string) {
      return `\x1b[200~${text}\x1b[201~`;
    }
  },
}));

vi.mock("../lib/stores/workspace", () => ({
  workspaces: { subscribe: vi.fn() },
}));

import { handleMenuPaste } from "../lib/services/menu-paste-router";

function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

beforeEach(() => {
  clearBody();
  invokeWritePty.mockClear();
  clipboardText.mockResolvedValue("hello world");
});

describe("handleMenuPaste", () => {
  it("routes to terminal via write_pty when focused element has data-pty-id", async () => {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-pty-id", "3");
    canvas.tabIndex = 0;
    document.body.appendChild(canvas);
    canvas.focus();

    await handleMenuPaste();

    expect(invokeWritePty).toHaveBeenCalledWith("write_pty", {
      ptyId: 3,
      data: "\x1b[200~hello world\x1b[201~",
    });
  });

  it("routes to terminal via write_pty when focus is on a child of a data-pty-id element", async () => {
    const outer = document.createElement("div");
    outer.setAttribute("data-pty-id", "7");
    const inner = document.createElement("textarea");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    inner.focus();

    await handleMenuPaste();

    expect(invokeWritePty).toHaveBeenCalledWith("write_pty", {
      ptyId: 7,
      data: "\x1b[200~hello world\x1b[201~",
    });
  });

  it("does not paste when terminal ptyId is -1 (unspawned)", async () => {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-pty-id", "-1");
    canvas.tabIndex = 0;
    document.body.appendChild(canvas);
    canvas.focus();

    await handleMenuPaste();

    expect(invokeWritePty).not.toHaveBeenCalledWith(
      "write_pty",
      expect.anything(),
    );
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
