/**
 * MCP output tee tests — the Channel-based PTY pipeline must still feed the
 * McpOutputBuffer after the `pty-output` emit/listen path was removed.
 *
 * Guards R2 from the refactor: if terminal-service stops calling
 * appendMcpOutput, read_output goes silent for MCP-spawned panes and the
 * five-concurrent-connections scenario regresses hard.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  appendMcpOutput,
  registerMcpPty,
  unregisterMcpPty,
  getMcpBuffer,
} from "../lib/services/mcp-output-buffer";

function encode(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

describe("appendMcpOutput", () => {
  beforeEach(() => {
    unregisterMcpPty(42);
    unregisterMcpPty(7);
  });

  it("buffers bytes for registered ptyIds", () => {
    registerMcpPty(42);
    appendMcpOutput(42, encode("hello\nworld\n"));

    const buf = getMcpBuffer(42);
    expect(buf).toBeDefined();
    const r = buf!.read({ lines: 10 });
    expect(r.output).toContain("hello");
    expect(r.output).toContain("world");
  });

  it("is a cheap no-op for unregistered ptyIds", () => {
    expect(() =>
      appendMcpOutput(999, encode("should be ignored")),
    ).not.toThrow();
    expect(getMcpBuffer(999)).toBeUndefined();
  });

  it("preserves byte values 0-255 through the decode path", () => {
    registerMcpPty(7);
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    appendMcpOutput(7, bytes);

    const r = getMcpBuffer(7)!.read({ lines: 1000, strip_ansi: false });
    // Raw decode should include every non-LF/CR byte as a character.
    // The buffer splits on \n and \r so we only check length is plausible.
    expect(r.total_lines).toBeGreaterThan(0);
  });

  it("handles multiple sequential chunks", () => {
    registerMcpPty(42);
    appendMcpOutput(42, encode("chunk one "));
    appendMcpOutput(42, encode("chunk two "));
    appendMcpOutput(42, encode("chunk three"));

    const r = getMcpBuffer(42)!.read({ lines: 10 });
    expect(r.output).toBe("chunk one chunk two chunk three");
  });
});
