/**
 * osc52-read.test.ts — OSC 52 clipboard read handler tests.
 *
 * Tests cover:
 * - osc52_read_round_trip_through_clipboard: read from clipboard and write to PTY
 * - encodeOsc52Response: correct base64 wrapping and empty-payload case
 * - handleClipboardRead: invokes write_pty with the correct OSC 52 sequence
 * - empty clipboard returns empty payload (not a broken escape sequence)
 * - errors are swallowed non-throwingly
 */

import { describe, it, expect } from "vitest";
import { encodeOsc52Response, handleClipboardRead } from "./osc52-read";
import type { InvokeFn, ClipboardReadFn } from "./osc52-read";

// ─── encodeOsc52Response ──────────────────────────────────────────────────────

describe("encodeOsc52Response", () => {
  it("wraps text in the canonical OSC 52 sequence", () => {
    const response = encodeOsc52Response("hello");
    // Should start with ESC ] 52 ; c ; and end with BEL
    expect(response).toMatch(/^\x1b]52;c;/);
    expect(response).toMatch(/\x07$/);
    // The base64 of "hello" is "aGVsbG8="
    expect(response).toBe("\x1b]52;c;aGVsbG8=\x07");
  });

  it("produces empty base64 payload for empty clipboard", () => {
    const response = encodeOsc52Response("");
    expect(response).toBe("\x1b]52;c;\x07");
  });

  it("encodes non-ASCII text (UTF-8 → base64)", () => {
    const response = encodeOsc52Response("café");
    expect(response).toMatch(/^\x1b]52;c;/);
    expect(response).toMatch(/\x07$/);
    // The base64 payload should be non-empty
    const b64 = response.slice("\x1b]52;c;".length, -1);
    expect(b64.length).toBeGreaterThan(0);
  });
});

// ─── handleClipboardRead ─────────────────────────────────────────────────────

describe("handleClipboardRead", () => {
  // ── osc52_read_round_trip_through_clipboard ───────────────────────────────

  it("osc52_read_round_trip_through_clipboard: reads clipboard and writes OSC 52 response to PTY", async () => {
    const invokeCalls: Array<[string, Record<string, unknown> | undefined]> =
      [];
    const invoke: InvokeFn = async (cmd, args) => {
      invokeCalls.push([cmd, args]);
    };
    const readClipboard: ClipboardReadFn = async () => "copied-text";

    await handleClipboardRead("pane-42", { invoke, readClipboard });

    expect(invokeCalls).toHaveLength(1);
    const [cmd, args] = invokeCalls[0]!;
    expect(cmd).toBe("write_pty");
    expect(args?.paneId).toBe("pane-42");

    // Verify the OSC 52 response wraps the base64 of "copied-text"
    const data = args?.data as string;
    expect(data).toMatch(/^\x1b]52;c;/);
    expect(data).toMatch(/\x07$/);

    // Decode and verify
    const b64 = data.slice("\x1b]52;c;".length, -1);
    const decoded = atob(b64);
    expect(decoded).toBe("copied-text");
  });

  it("sends an empty OSC 52 payload when clipboard is empty", async () => {
    const invokeCalls: Array<[string, Record<string, unknown> | undefined]> =
      [];
    const invoke: InvokeFn = async (cmd, args) => {
      invokeCalls.push([cmd, args]);
    };
    const readClipboard: ClipboardReadFn = async () => "";

    await handleClipboardRead("pane-1", { invoke, readClipboard });

    expect(invokeCalls).toHaveLength(1);
    const data = invokeCalls[0]![1]?.data as string;
    expect(data).toBe("\x1b]52;c;\x07");
  });

  it("does not throw when clipboard read fails", async () => {
    const invokeCalls: Array<[string, Record<string, unknown> | undefined]> =
      [];
    const invoke: InvokeFn = async (cmd, args) => {
      invokeCalls.push([cmd, args]);
    };
    const readClipboard: ClipboardReadFn = async () => {
      throw new Error("clipboard unavailable");
    };

    // Should not throw
    await expect(
      handleClipboardRead("pane-x", { invoke, readClipboard }),
    ).resolves.toBeUndefined();

    // Still sends the empty-payload response (clipboard error → empty string)
    expect(invokeCalls).toHaveLength(1);
    const data = invokeCalls[0]![1]?.data as string;
    expect(data).toBe("\x1b]52;c;\x07");
  });

  it("does not throw when write_pty invoke fails", async () => {
    const invoke: InvokeFn = async () => {
      throw new Error("PTY write failed");
    };
    const readClipboard: ClipboardReadFn = async () => "some text";

    await expect(
      handleClipboardRead("pane-y", { invoke, readClipboard }),
    ).resolves.toBeUndefined();
  });

  it("forwards the correct paneId to write_pty", async () => {
    const invokeCalls: Array<[string, Record<string, unknown> | undefined]> =
      [];
    const invoke: InvokeFn = async (cmd, args) => {
      invokeCalls.push([cmd, args]);
    };
    const readClipboard: ClipboardReadFn = async () => "text";

    await handleClipboardRead("my-pane-id", { invoke, readClipboard });

    expect(invokeCalls[0]![1]?.paneId).toBe("my-pane-id");
  });
});
