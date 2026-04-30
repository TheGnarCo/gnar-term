/**
 * OSC 8 hyperlink provider tests.
 *
 * Verifies createOsc8LinkProvider walks a buffer line, groups runs of
 * cells sharing a non-zero linkId into ranges, and resolves the URI via
 * xterm.js's internal _oscLinkService. Activation is wired to the Tauri
 * `open_url` command.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mockIPC,
  mockWindows,
  clearMocks,
  mockConvertFileSrc,
} from "@tauri-apps/api/mocks";
import { randomFillSync } from "crypto";
import type { Terminal } from "@xterm/xterm";
import type { ILink } from "@xterm/xterm";

beforeEach(() => {
  Object.defineProperty(window, "crypto", {
    value: { getRandomValues: (buf: Uint8Array) => randomFillSync(buf) },
    writable: true,
  });
  mockWindows("main");
  mockConvertFileSrc("macos");
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

// ─── Helpers ─────────────────────────────────────────────────────

interface FakeCell {
  getLinkId: () => number;
  char: string;
}

/**
 * Build a fake xterm.js Terminal exposing only the surface
 * createOsc8LinkProvider depends on:
 *   - terminal.buffer.active.getLine(y)
 *       → line.length, line.getCell(x), line.translateToString(...)
 *   - terminal._core._oscLinkService.getLinkData(id) → { uri }
 */
function makeFakeTerminal(opts: {
  cells: FakeCell[] | null; // null → getLine returns undefined
  linkData: Record<number, { uri: string }>;
}): Terminal {
  const { cells, linkData } = opts;

  const line =
    cells == null
      ? null
      : {
          length: cells.length,
          getCell: (x: number) =>
            x >= 0 && x < cells.length ? cells[x] : null,
          translateToString: (_trim: boolean, start?: number, end?: number) => {
            const s = start ?? 0;
            const e = end ?? cells.length;
            return cells
              .slice(s, e)
              .map((c) => c.char)
              .join("");
          },
        };

  return {
    buffer: {
      active: {
        getLine: (_y: number) => line,
      },
    },
    _core: {
      _oscLinkService: {
        getLinkData: (id: number) => linkData[id],
      },
    },
  } as unknown as Terminal;
}

function cellsFromString(
  text: string,
  ranges: { from: number; to: number; linkId: number }[],
): FakeCell[] {
  return Array.from(text).map((char, i) => {
    const r = ranges.find((rr) => i >= rr.from && i < rr.to);
    return { char, getLinkId: () => (r ? r.linkId : 0) };
  });
}

function provideLinksAsync(
  provider: {
    provideLinks: (y: number, cb: (links: ILink[] | undefined) => void) => void;
  },
  y: number,
): Promise<ILink[] | undefined> {
  return new Promise<ILink[] | undefined>((resolve) =>
    provider.provideLinks(y, (links) => resolve(links)),
  );
}

// ─── Tests ───────────────────────────────────────────────────────

describe("createOsc8LinkProvider", () => {
  it("emits a link spanning cells with the same non-zero linkId", async () => {
    const { createOsc8LinkProvider } = await import("../lib/terminal-service");

    // Buffer: "go to click me here"
    //          0         1
    //          0123456789012345678
    // The substring "click me" is at indices 6..13 (inclusive).
    const text = "go to click me here";
    const cells = cellsFromString(text, [{ from: 6, to: 14, linkId: 7 }]);
    const terminal = makeFakeTerminal({
      cells,
      linkData: { 7: { uri: "https://example.com" } },
    });

    const provider = createOsc8LinkProvider(terminal);
    const got = await provideLinksAsync(provider, 1);

    expect(got).toBeDefined();
    expect(got).toHaveLength(1);
    expect(got![0].text).toBe("click me");
    // xterm.js link ranges are 1-based, end inclusive.
    expect(got![0].range).toEqual({
      start: { x: 7, y: 1 },
      end: { x: 14, y: 1 },
    });
  });

  it("activate() invokes open_url with the OSC 8 URI", async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return undefined;
    });

    const { createOsc8LinkProvider } = await import("../lib/terminal-service");

    const cells = cellsFromString("hi link", [{ from: 3, to: 7, linkId: 42 }]);
    const terminal = makeFakeTerminal({
      cells,
      linkData: { 42: { uri: "https://anthropic.com" } },
    });

    const provider = createOsc8LinkProvider(terminal);
    const links = await provideLinksAsync(provider, 1);

    expect(links).toHaveLength(1);
    links![0].activate(new MouseEvent("click"), links![0].text);

    // open_url is invoked with the uri from the OSC link service.
    expect(
      calls.some(
        (c) =>
          c.cmd === "open_url" &&
          (c.args as Record<string, string>).url === "https://anthropic.com",
      ),
    ).toBe(true);
  });

  it("emits multiple disjoint links on the same line", async () => {
    const { createOsc8LinkProvider } = await import("../lib/terminal-service");

    const text = "AAA  BBB";
    const cells = cellsFromString(text, [
      { from: 0, to: 3, linkId: 1 },
      { from: 5, to: 8, linkId: 2 },
    ]);
    const terminal = makeFakeTerminal({
      cells,
      linkData: {
        1: { uri: "https://one.example" },
        2: { uri: "https://two.example" },
      },
    });

    const provider = createOsc8LinkProvider(terminal);
    const got = await provideLinksAsync(provider, 1);

    expect(got).toHaveLength(2);
    expect(got![0].text).toBe("AAA");
    expect(got![0].range.start.x).toBe(1);
    expect(got![0].range.end.x).toBe(3);
    expect(got![1].text).toBe("BBB");
    expect(got![1].range.start.x).toBe(6);
    expect(got![1].range.end.x).toBe(8);
  });

  it("produces no links when no cells carry an OSC 8 linkId", async () => {
    const { createOsc8LinkProvider } = await import("../lib/terminal-service");

    const cells = cellsFromString("plain text", []);
    const terminal = makeFakeTerminal({ cells, linkData: {} });

    const provider = createOsc8LinkProvider(terminal);
    const got = await provideLinksAsync(provider, 1);

    expect(got).toBeUndefined();
  });

  it("returns no links when the line is missing", async () => {
    const { createOsc8LinkProvider } = await import("../lib/terminal-service");

    const terminal = makeFakeTerminal({ cells: null, linkData: {} });

    const provider = createOsc8LinkProvider(terminal);
    const got = await provideLinksAsync(provider, 99);

    expect(got).toBeUndefined();
  });

  it("returns no links when _oscLinkService is unavailable", async () => {
    const { createOsc8LinkProvider } = await import("../lib/terminal-service");

    // Build a terminal whose _core lacks the OSC link service.
    const cells = cellsFromString("hi", [{ from: 0, to: 2, linkId: 1 }]);
    const terminal = {
      buffer: {
        active: {
          getLine: () => ({
            length: cells.length,
            getCell: (x: number) => cells[x] ?? null,
            translateToString: () => "hi",
          }),
        },
      },
      _core: {},
    } as unknown as Terminal;

    const provider = createOsc8LinkProvider(terminal);
    const got = await provideLinksAsync(provider, 1);

    expect(got).toBeUndefined();
  });

  it("skips spans whose linkId is missing from the OSC link service", async () => {
    const { createOsc8LinkProvider } = await import("../lib/terminal-service");

    const cells = cellsFromString("hello", [{ from: 0, to: 5, linkId: 9 }]);
    // Note: linkData has no entry for id 9.
    const terminal = makeFakeTerminal({ cells, linkData: {} });

    const provider = createOsc8LinkProvider(terminal);
    const got = await provideLinksAsync(provider, 1);

    expect(got).toBeUndefined();
  });

  it("flushes a span that ends on the final cell of the line", async () => {
    const { createOsc8LinkProvider } = await import("../lib/terminal-service");

    const text = "go LINK";
    const cells = cellsFromString(text, [{ from: 3, to: 7, linkId: 5 }]);
    const terminal = makeFakeTerminal({
      cells,
      linkData: { 5: { uri: "https://edge.example" } },
    });

    const provider = createOsc8LinkProvider(terminal);
    const got = await provideLinksAsync(provider, 1);

    expect(got).toHaveLength(1);
    expect(got![0].text).toBe("LINK");
    expect(got![0].range.start.x).toBe(4);
    expect(got![0].range.end.x).toBe(7);
  });
});
