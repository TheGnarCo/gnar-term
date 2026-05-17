/**
 * osc52-read.ts — OSC 52 clipboard read (host → terminal) handler.
 *
 * When the running program inside a pane sends an OSC 52 "?" sequence it is
 * asking the host terminal for the current clipboard contents. The Rust
 * PtyBridge handles this entirely for the existing xterm.js surface via
 * `Event::ClipboardLoad`. This module provides the **TypeScript** side for the
 * AlacrittyTerminalSurface: if the engine routes a clipboard-read request over
 * the IPC channel (e.g. via a future `{ kind: "clipboard_read_request" }`
 * message), the frontend reads from the Tauri clipboard plugin and writes the
 * response back to the PTY via the `write_pty` invoke.
 *
 * ## Why a TS handler?
 *
 * The Rust-side `PtyBridge::ClipboardLoad` handler is the primary path.
 * This module is a **secondary, frontend-driven path** for the
 * AlacrittyTerminalSurface component (cycle-21) so that the component can
 * intercept and handle clipboard-read requests without requiring the bridge to
 * hold a live `AppHandle`. It is also independently testable without a Tauri
 * runtime.
 *
 * ## Wire protocol
 *
 * OSC 52 read request: `\x1b]52;c;?\x07`  (the `?` triggers a read).
 *
 * Response sent back to PTY: the Tauri clipboard text, base64-encoded, wrapped
 * in the canonical OSC 52 response:
 *   `\x1b]52;c;<base64>\x07`
 *
 * If the clipboard is empty or unavailable the response is an empty payload:
 *   `\x1b]52;c;\x07`
 *
 * @module osc52-read
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Injectable Tauri invoke function (or test double). */
export type InvokeFn = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** Injectable Tauri clipboard read function (or test double). */
export type ClipboardReadFn = () => Promise<string>;

/** Options for `handleClipboardRead`. */
export interface Osc52ReadOptions {
  /**
   * Injectable Tauri `invoke` override for calling `write_pty`.
   * Defaults to `window.__TAURI__.core.invoke` when omitted.
   */
  invoke?: InvokeFn;

  /**
   * Injectable clipboard read function.
   * Defaults to `@tauri-apps/plugin-clipboard-manager`'s `readText`.
   */
  readClipboard?: ClipboardReadFn;
}

// ─── OSC 52 response encoding ──────────────────────────────────────────────────

/**
 * Encode `text` as a valid OSC 52 clipboard-response sequence.
 *
 * Format: `ESC ] 52 ; c ; <base64> BEL`
 * Empty clipboard → `ESC ] 52 ; c ; BEL` (empty base64 payload).
 *
 * Uses `btoa` (available in WebView environments) for base64 encoding.
 */
export function encodeOsc52Response(text: string): string {
  const b64 = text.length > 0 ? btoa(unescape(encodeURIComponent(text))) : "";
  return `\x1b]52;c;${b64}\x07`;
}

// ─── handleClipboardRead ────────────────────────────────────────────────────────

/**
 * Handle an OSC 52 clipboard-read request from the terminal.
 *
 * Reads the current clipboard content and writes an OSC 52 response back to
 * the PTY identified by `paneId`.
 *
 * This function is async and non-throwing: clipboard or PTY-write errors are
 * caught and silently discarded (the requesting program will time out waiting
 * for the response, which is the correct degraded behaviour when clipboard
 * access is unavailable).
 *
 * @param paneId  - The pane whose PTY should receive the clipboard response.
 * @param opts    - Injectable dependencies (invoke, readClipboard).
 */
export async function handleClipboardRead(
  paneId: string,
  opts: Osc52ReadOptions = {},
): Promise<void> {
  const invokeImpl: InvokeFn =
    opts.invoke ??
    ((cmd, args) =>
      (
        window as unknown as {
          __TAURI__: { core: { invoke: InvokeFn } };
        }
      ).__TAURI__.core.invoke(cmd, args));

  const readClipboard: ClipboardReadFn =
    opts.readClipboard ??
    (async () => {
      // Dynamic import so this module can be loaded without the Tauri runtime
      // (e.g. in unit tests where opts.readClipboard is always injected).
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return readText();
    });

  try {
    const text = await readClipboard().catch(() => "");
    const response = encodeOsc52Response(text);
    await invokeImpl("write_pty", { paneId, data: response });
  } catch {
    // Non-throwing: clipboard or PTY errors are discarded silently.
  }
}
