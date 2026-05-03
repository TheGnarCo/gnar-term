import { describe, it, expect } from "vitest";
import { readTerminalBuffer } from "../lib/services/session-log-service";

function makeMockSurface(lines: (string | null)[]) {
  return {
    terminal: {
      buffer: {
        active: {
          length: lines.length,
          getLine: (i: number) => {
            const line = lines[i];
            if (line === null) return null;
            return {
              translateToString: (_trim: boolean) => line,
            };
          },
        },
      },
    },
  };
}

describe("readTerminalBuffer", () => {
  it("returns joined lines from the buffer", () => {
    const surface = makeMockSurface(["line 1", "line 2", "line 3"]);
    expect(readTerminalBuffer(surface)).toBe("line 1\nline 2\nline 3");
  });

  it("returns null for empty buffer", () => {
    const surface = makeMockSurface([]);
    expect(readTerminalBuffer(surface)).toBeNull();
  });

  it("trims trailing blank lines", () => {
    const surface = makeMockSurface(["content", "", "  "]);
    expect(readTerminalBuffer(surface)).toBe("content");
  });

  it("returns null when terminal is missing", () => {
    expect(readTerminalBuffer({})).toBeNull();
  });

  it("returns null when buffer is missing", () => {
    expect(readTerminalBuffer({ terminal: {} })).toBeNull();
  });

  it("returns null when all lines are blank", () => {
    const surface = makeMockSurface(["", "  ", "\t"]);
    expect(readTerminalBuffer(surface)).toBeNull();
  });

  it("skips null lines from getLine", () => {
    const surface = makeMockSurface(["line 1", null, "line 3"]);
    expect(readTerminalBuffer(surface)).toBe("line 1\nline 3");
  });

  it("caps at MAX_LINES (1000) from the end", () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `line ${i}`);
    const surface = makeMockSurface(lines);
    const result = readTerminalBuffer(surface);
    expect(result).not.toContain("line 0");
    expect(result).toContain("line 200");
    expect(result).toContain("line 1199");
  });
});
