/**
 * Menu paste router — handles the `menu-paste` event emitted from the
 * native Edit > Paste menu item (Cmd+V on macOS / Ctrl+V on Linux).
 *
 * Why a custom router: the menu accelerator preempts webview keydown,
 * so the in-canvas Cmd+V handler in AlacrittyTerminalSurface is dead
 * code in production. Worse, the default `PredefinedMenuItem::paste`
 * dispatches the native NSText `paste:` action, which delivers via
 * input events and bypasses bracketed-paste wrapping.
 * Claude Code (and other TUIs) rely on `\x1b[200~…\x1b[201~` to
 * recognize a paste — without it they process the buffer character-
 * by-character, submitting on the first newline.
 *
 * The router routes by focus:
 *   - terminal surface canvas  → write_pty with PasteHandler bracketed encoding
 *   - input/textarea           → splice at selection, fire `input` event
 *   - contenteditable          → `document.execCommand("insertText")`
 *   - nothing focused          → no-op
 */
import { readText as clipboardRead } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { PasteHandler } from "../components/alacritty/paste-handler";

// Shared PasteHandler instance. Bracketed paste mode is per-PTY, but the
// default (enabled) is safe for all contexts so a single instance is fine.
const _pasteHandler = new PasteHandler();

function findPtyIdForElement(el: Element): number | null {
  // AlacrittyTerminalSurface canvas elements carry data-pty-id.
  // Walk up from the focused element in case a child has focus.
  let node: Element | null = el;
  while (node) {
    const v = node.getAttribute("data-pty-id");
    if (v !== null) {
      const id = parseInt(v, 10);
      return isNaN(id) ? null : id;
    }
    node = node.parentElement;
  }
  return null;
}

function pasteIntoInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  el.value = next;
  const cursor = start + text.length;
  el.setSelectionRange(cursor, cursor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function handleMenuPaste(): Promise<void> {
  let text: string;
  try {
    text = await clipboardRead();
  } catch (err) {
    console.warn("Menu paste: clipboard read failed:", err);
    return;
  }
  if (!text) return;

  const active = document.activeElement;
  if (!active) return;

  const ptyId = findPtyIdForElement(active);
  if (ptyId !== null && ptyId >= 0) {
    const encoded = _pasteHandler.encodePaste(text);
    void invoke("write_pty", { ptyId, data: encoded }).catch((err) => {
      console.warn("Menu paste: write_pty failed:", err);
    });
    return;
  }

  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement
  ) {
    pasteIntoInput(active, text);
    return;
  }

  if (
    active instanceof HTMLElement &&
    (active.isContentEditable || active.contentEditable === "true")
  ) {
    document.execCommand("insertText", false, text);
  }
}
