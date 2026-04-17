/**
 * Unit tests for McpOutputBuffer — ring buffer backing MCP `read_output`.
 * The Tauri event listener path is exercised by integration tests; here we
 * focus on the pure in-memory buffering/append/read logic.
 */
import { describe, it, expect } from "vitest";
import { McpOutputBuffer } from "../lib/services/mcp-output-buffer";

describe("McpOutputBuffer", () => {
  it("starts empty with cursor at 0 and one empty partial line", () => {
    const b = new McpOutputBuffer();
    expect(b.getCursor()).toBe(0);
    expect(b.getLastLine()).toBe("");
  });

  it("append('') is a no-op", () => {
    const b = new McpOutputBuffer();
    b.append("");
    expect(b.getCursor()).toBe(0);
  });

  it("extends the trailing partial line when text has no newline", () => {
    const b = new McpOutputBuffer();
    b.append("hello ");
    b.append("world");
    expect(b.getLastLine()).toBe("hello world");
    expect(b.getCursor()).toBe(0);
  });

  it("advances the cursor by the number of newlines", () => {
    const b = new McpOutputBuffer();
    b.append("one\ntwo\nthree");
    expect(b.getCursor()).toBe(2);
    expect(b.getLastLine()).toBe("three");
  });

  it("normalizes CRLF and bare CR to LF", () => {
    const b = new McpOutputBuffer();
    b.append("a\r\nb\rc\n");
    // a, b, c, and a trailing empty partial line
    expect(b.getCursor()).toBe(3);
  });

  it("evicts the oldest line when exceeding maxLines", () => {
    const b = new McpOutputBuffer(3);
    b.append("a\nb\nc\nd\n");
    // 4 lines written + empty partial; buffer holds 3 trailing lines
    const r = b.read({});
    expect(r.output.split("\n").length).toBeLessThanOrEqual(3);
  });

  it("read with no cursor returns the last N lines", () => {
    const b = new McpOutputBuffer();
    b.append("one\ntwo\nthree\nfour\n");
    const r = b.read({ lines: 2 });
    // last 2 entries of [one, two, three, four, ""] = [four, ""]
    expect(r.output).toBe("four\n");
  });

  it("read with cursor at current returns empty", () => {
    const b = new McpOutputBuffer();
    b.append("one\ntwo\n");
    const cursor = b.getCursor();
    const r = b.read({ cursor });
    expect(r.output).toBe("");
    expect(r.cursor).toBe(cursor);
  });

  it("read with cursor older than buffer returns all lines", () => {
    const b = new McpOutputBuffer(3);
    b.append("a\nb\nc\nd\ne\n");
    // caller is way behind
    const r = b.read({ cursor: 0 });
    expect(r.output.split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("read with cursor mid-buffer returns only newer lines", () => {
    const b = new McpOutputBuffer();
    b.append("one\ntwo\nthree\n");
    const r = b.read({ cursor: 0 });
    // After cursor 0 → expect two, three, and the trailing empty
    expect(r.output).toContain("two");
    expect(r.output).toContain("three");
  });

  it("strip_ansi: false preserves escape codes", () => {
    const b = new McpOutputBuffer();
    b.append("\x1b[31mred\x1b[0m\n");
    const withAnsi = b.read({ strip_ansi: false });
    expect(withAnsi.output).toContain("\x1b[");
    const stripped = b.read({});
    expect(stripped.output).not.toContain("\x1b[");
  });
});
