/**
 * Menu paste router — handles the `menu-paste` event emitted from the native
 * Edit > Paste menu item (Cmd+V on macOS / Ctrl+V on Linux/Windows).
 *
 * Why a custom router: the menu accelerator preempts webview keydown, so the
 * in-terminal Cmd+V handler in terminal-service.ts is effectively dead in
 * production. Worse, the default `PredefinedMenuItem::paste` dispatches the
 * native NSText `paste:` action, which delivers via input events and bypasses
 * xterm.js's bracketed-paste wrapping. Claude Code (and other TUIs) rely on
 * `\x1b[200~…\x1b[201~` to recognize a paste — without it they process the
 * buffer character-by-character, submitting on the first newline.
 *
 * The router routes by focus:
 *   - terminal surface  → `surface.terminal.paste(text)` (bracketed)
 *   - input/textarea    → splice at selection, fire `input` event
 *   - contenteditable   → `document.execCommand("insertText")`
 *   - nothing focused   → no-op
 */
import { readText as clipboardRead } from "@tauri-apps/plugin-clipboard-manager";
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import {
  getAllSurfaces,
  isTerminalSurface,
  type TerminalSurface,
} from "../types";

function findTerminalForElement(el: Element): TerminalSurface | null {
  for (const ws of get(workspaces)) {
    for (const surface of getAllSurfaces(ws)) {
      if (isTerminalSurface(surface) && surface.termElement.contains(el)) {
        return surface;
      }
    }
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

  const terminal = findTerminalForElement(active);
  if (terminal && terminal.ptyId >= 0) {
    terminal.terminal.paste(text);
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
