/**
 * Programmatic output buffer for MCP-spawned terminal sessions.
 *
 * terminal-service routes each PTY chunk through `appendMcpOutput()` after
 * writing to xterm; this maintains a parallel plain-text ring buffer that MCP
 * `read_output` calls can query. Only ptyIds explicitly registered via
 * `registerMcpPty()` are buffered — plain user-spawned terminals pay nothing.
 */
import { RingBuffer } from "../utils/ring-buffer";

const MAX_LINES_DEFAULT = 5000;
const decoder = new TextDecoder();
const ANSI_REGEX =
  // eslint-disable-next-line security/detect-unsafe-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z0-9/#&.:=?%@~_]+)*|[a-zA-Z0-9]+(?:;[-a-zA-Z0-9/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, "");
}

export interface ReadResult {
  output: string;
  cursor: number;
  total_lines: number;
}

export class McpOutputBuffer {
  /**
   * Completed lines only — capacity is (maxLines - 1) so that the total
   * of completed lines + one partial line never exceeds maxLines.
   */
  private _ring: RingBuffer<string>;
  /** The current in-progress (not yet newline-terminated) line. */
  private _partial = "";
  private _cursor = 0;
  private readonly maxLines: number;

  constructor(maxLines: number = MAX_LINES_DEFAULT) {
    this.maxLines = maxLines;
    // Reserve one slot for the partial line so total stored ≤ maxLines.
    this._ring = new RingBuffer<string>(Math.max(1, maxLines - 1));
  }

  append(text: string): void {
    if (!text) return;
    // Normalize CRLF and bare CR to LF for line splitting, but preserve the
    // original characters when appending to the current partial line so
    // xterm-style escape sequences survive for cursor calculations.
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = normalized.split("\n");
    // parts[0] extends the current partial line; each subsequent entry is a
    // new line. The trailing empty string (when text ends with \n) is the
    // start of a new empty partial line.
    this._partial = (this._partial ?? "") + (parts[0] ?? "");
    for (let i = 1; i < parts.length; i++) {
      this._cursor += 1;
      // Push the completed partial line into the ring. O(1) — evicts the
      // oldest completed line when full instead of O(N) shift.
      this._ring.push(this._partial);
      this._partial = parts[i] ?? "";
    }
  }

  /**
   * Read from the buffer.
   *
   * - With `cursor`: return all lines written after that cursor value. The
   *   returned cursor advances past what was read.
   * - Without `cursor`: return the last `lines` entries (default 50).
   */
  read(opts: {
    lines?: number;
    cursor?: number;
    strip_ansi?: boolean;
  }): ReadResult {
    const strip = opts.strip_ansi !== false;
    // Build the full logical view: completed lines in the ring + partial tail.
    // The partial line sits at cursor index `_cursor`; the oldest completed
    // line in the ring is at cursor index `_cursor - ring.length`.
    const completed = this._ring.toArray();
    const logical = [...completed, this._partial];
    const oldestIdx = this._cursor - this._ring.length;
    let slice: string[];
    if (opts.cursor !== undefined) {
      if (opts.cursor >= this._cursor) {
        slice = [];
      } else if (opts.cursor < oldestIdx - 1) {
        slice = logical;
      } else {
        const offset = opts.cursor - oldestIdx + 1;
        slice = logical.slice(offset);
      }
    } else {
      const n = opts.lines ?? 50;
      slice = logical.slice(-n);
    }
    const out = strip ? slice.map(stripAnsi) : slice;
    return {
      output: out.join("\n"),
      cursor: this._cursor,
      total_lines: this._cursor + 1,
    };
  }

  getCursor(): number {
    return this._cursor;
  }

  getLastLine(): string {
    return this._partial;
  }
}

const buffers = new Map<number, McpOutputBuffer>();

export function registerMcpPty(ptyId: number): McpOutputBuffer {
  if (ptyId < 0) {
    throw new Error(`cannot register invalid pty id ${ptyId}`);
  }
  let buffer = buffers.get(ptyId);
  if (!buffer) {
    buffer = new McpOutputBuffer();
    buffers.set(ptyId, buffer);
  }
  return buffer;
}

export function unregisterMcpPty(ptyId: number): void {
  buffers.delete(ptyId);
}

export function getMcpBuffer(ptyId: number): McpOutputBuffer | undefined {
  return buffers.get(ptyId);
}

/**
 * Feed raw PTY bytes into the per-pty MCP buffer, if one is registered.
 * Cheap no-op for ptys that no MCP caller is observing. Called from
 * terminal-service's channel onmessage handler.
 */
export function appendMcpOutput(ptyId: number, bytes: Uint8Array): void {
  const buffer = buffers.get(ptyId);
  if (!buffer) return;
  const text = decoder.decode(bytes);
  buffer.append(text);
}
