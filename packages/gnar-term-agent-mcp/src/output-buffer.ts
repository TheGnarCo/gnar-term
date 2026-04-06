import stripAnsi from "strip-ansi";

export interface ReadResult {
  lines: string[];
  cursor: number;
  totalLines: number;
}

export interface ReadOptions {
  lastN?: number;
  sinceCursor?: number;
  shouldStripAnsi?: boolean;
}

/**
 * Ring buffer that stores terminal output lines with monotonic cursor tracking.
 * Supports two read modes:
 * - Last N lines: `read({ lastN: 50 })`
 * - Since cursor: `read({ sinceCursor: 4200 })` for polling without data loss
 */
export class OutputBuffer {
  private buffer: string[] = [];
  private cursor = 0; // monotonic sequence number for next line
  private partialLine = "";
  private maxLines: number;

  constructor(maxLines = 5000) {
    this.maxLines = maxLines;
  }

  /** Append raw PTY data. Splits on newlines, accumulates partial lines. */
  append(data: string): void {
    const text = this.partialLine + data;
    const parts = text.split("\n");
    // Last element is either empty (if data ended with \n) or a partial line
    this.partialLine = parts.pop() ?? "";
    for (const line of parts) {
      this.pushLine(line);
    }
  }

  private pushLine(line: string): void {
    if (this.buffer.length >= this.maxLines) {
      this.buffer.shift();
    }
    this.buffer.push(line);
    this.cursor++;
  }

  /** Read lines from the buffer. */
  read(opts: ReadOptions): ReadResult {
    const { lastN = 50, sinceCursor, shouldStripAnsi = true } = opts;
    const transform = shouldStripAnsi ? stripAnsi : (s: string) => s;

    let lines: string[];
    if (sinceCursor !== undefined) {
      const startIndex = this.cursorToIndex(sinceCursor);
      lines = this.buffer.slice(startIndex);
    } else {
      lines = this.buffer.slice(-lastN);
    }

    // Include current partial line if non-empty
    if (this.partialLine) {
      lines = [...lines, this.partialLine];
    }

    return {
      lines: lines.map(transform),
      cursor: this.cursor,
      totalLines: this.buffer.length,
    };
  }

  /** Get the last line (or partial) for prompt pattern matching. */
  getLastLine(): string {
    if (this.partialLine) return stripAnsi(this.partialLine);
    if (this.buffer.length > 0) return stripAnsi(this.buffer[this.buffer.length - 1]);
    return "";
  }

  /** Current cursor position. */
  getCursor(): number {
    return this.cursor;
  }

  /** Convert a cursor value to a buffer index. */
  private cursorToIndex(targetCursor: number): number {
    const bufferStartCursor = this.cursor - this.buffer.length;
    if (targetCursor <= bufferStartCursor) return 0;
    if (targetCursor >= this.cursor) return this.buffer.length;
    return targetCursor - bufferStartCursor;
  }
}
