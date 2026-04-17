/**
 * Programmatic output buffer for MCP-spawned terminal sessions.
 *
 * terminal-service routes each PTY chunk through `appendMcpOutput()` after
 * writing to xterm; this maintains a parallel plain-text ring buffer that MCP
 * `read_output` calls can query. Only ptyIds explicitly registered via
 * `registerMcpPty()` are buffered — plain user-spawned terminals pay nothing.
 */
const MAX_LINES_DEFAULT = 5000;
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
  private lines: string[] = [""];
  private cursor = 0;
  private readonly maxLines: number;

  constructor(maxLines: number = MAX_LINES_DEFAULT) {
    this.maxLines = maxLines;
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
    this.lines[this.lines.length - 1] =
      (this.lines[this.lines.length - 1] ?? "") + (parts[0] ?? "");
    for (let i = 1; i < parts.length; i++) {
      this.cursor += 1;
      this.lines.push(parts[i] ?? "");
      if (this.lines.length > this.maxLines) {
        this.lines.shift();
      }
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
    // `lines` includes the trailing partial line as the last entry, so index
    // math treats the buffer as containing (this.cursor - this.lines.length + 1)
    // through `this.cursor` inclusive, where the last entry is index `cursor`.
    const oldestIdx = this.cursor - (this.lines.length - 1);
    let slice: string[];
    if (opts.cursor !== undefined) {
      if (opts.cursor >= this.cursor) {
        slice = [];
      } else if (opts.cursor < oldestIdx - 1) {
        slice = [...this.lines];
      } else {
        const offset = opts.cursor - oldestIdx + 1;
        slice = this.lines.slice(offset);
      }
    } else {
      const n = opts.lines ?? 50;
      slice = this.lines.slice(-n);
    }
    const out = strip ? slice.map(stripAnsi) : slice;
    return {
      output: out.join("\n"),
      cursor: this.cursor,
      total_lines: this.cursor + 1,
    };
  }

  getCursor(): number {
    return this.cursor;
  }

  getLastLine(): string {
    return this.lines[this.lines.length - 1] ?? "";
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
  let text = "";
  for (let i = 0; i < bytes.length; i++) {
    text += String.fromCharCode(bytes[i]!);
  }
  buffer.append(text);
}
