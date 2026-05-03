import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readTerminalBuffer,
  writeSessionLogsForAllSurfaces,
} from "../lib/services/session-log-service";
import { nestedWorkspaces } from "../lib/stores/nested-workspace";
import type { NestedWorkspace } from "../lib/types";

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

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

// Helper to build a minimal NestedWorkspace with terminal surfaces for
// writeSessionLogsForAllSurfaces tests.
function makeNestedWorkspaceWithTerminals(
  wsId: string,
  surfaces: Array<{ id: string; ptyId: number; lines: string[] }>,
): NestedWorkspace {
  return {
    id: wsId,
    name: wsId,
    splitRoot: {
      type: "pane",
      pane: {
        id: `${wsId}-p`,
        surfaces: surfaces.map((s) => ({
          kind: "terminal" as const,
          id: s.id,
          title: s.id,
          hasUnread: false,
          opened: false,
          ptyId: s.ptyId,
          terminal: makeMockSurface(s.lines).terminal,
          fitAddon: {} as never,
          searchAddon: {} as never,
          termElement: document.createElement("div"),
        })),
        activeSurfaceId: surfaces[0]?.id ?? null,
      },
    },
    activePaneId: `${wsId}-p`,
  } as unknown as NestedWorkspace;
}

describe("writeSessionLogsForAllSurfaces", () => {
  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue(undefined);
    nestedWorkspaces.set([]);
  });

  it("writes session logs for all live terminals with buffer content", async () => {
    nestedWorkspaces.set([
      makeNestedWorkspaceWithTerminals("ws1", [
        { id: "s1", ptyId: 1, lines: ["hello world"] },
        { id: "s2", ptyId: 2, lines: ["another line"] },
      ]),
    ]);

    await writeSessionLogsForAllSurfaces();

    // Each surface triggers ensure_dir + write_file (2 invoke calls per surface)
    const writeCalls = invokeMock.mock.calls.filter(
      ([cmd]: [string]) => cmd === "write_file",
    );
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0]![1]).toMatchObject({ content: "hello world" });
    expect(writeCalls[1]![1]).toMatchObject({ content: "another line" });
  });

  it("skips terminals with ptyId < 0 (not yet spawned)", async () => {
    nestedWorkspaces.set([
      makeNestedWorkspaceWithTerminals("ws1", [
        { id: "s1", ptyId: -1, lines: ["should be skipped"] },
        { id: "s2", ptyId: 5, lines: ["should be written"] },
      ]),
    ]);

    await writeSessionLogsForAllSurfaces();

    const writeCalls = invokeMock.mock.calls.filter(
      ([cmd]: [string]) => cmd === "write_file",
    );
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]![1]).toMatchObject({ content: "should be written" });
  });

  it("skips surfaces with empty buffers", async () => {
    nestedWorkspaces.set([
      makeNestedWorkspaceWithTerminals("ws1", [
        { id: "s1", ptyId: 3, lines: [] },
      ]),
    ]);

    await writeSessionLogsForAllSurfaces();

    const writeCalls = invokeMock.mock.calls.filter(
      ([cmd]: [string]) => cmd === "write_file",
    );
    expect(writeCalls).toHaveLength(0);
  });

  it("handles multiple workspaces", async () => {
    nestedWorkspaces.set([
      makeNestedWorkspaceWithTerminals("ws1", [
        { id: "s1", ptyId: 1, lines: ["ws1 output"] },
      ]),
      makeNestedWorkspaceWithTerminals("ws2", [
        { id: "s2", ptyId: 2, lines: ["ws2 output"] },
      ]),
    ]);

    await writeSessionLogsForAllSurfaces();

    const writeCalls = invokeMock.mock.calls.filter(
      ([cmd]: [string]) => cmd === "write_file",
    );
    expect(writeCalls).toHaveLength(2);
  });

  it("resolves even when there are no workspaces", async () => {
    nestedWorkspaces.set([]);
    await expect(writeSessionLogsForAllSurfaces()).resolves.toBeUndefined();
  });
});
