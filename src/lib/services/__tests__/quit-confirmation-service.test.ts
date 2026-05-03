/**
 * Unit tests for the quit-confirmation gate.
 *
 * Verifies that:
 *   - When zero terminals are live the dialog is bypassed (no `ask` call).
 *   - When live terminals exist the dialog message includes the count and
 *     pluralization is correct.
 *   - The `ptyId === -1` filter skips terminals still spawning.
 *   - A rejected dialog promise resolves to `false` so quit is cancelled.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const askMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { nestedWorkspaces } from "../../stores/nested-workspace";
import type { NestedWorkspace } from "../../types";
import { confirmQuit, countLiveTerminals } from "../quit-confirmation-service";

function makeTerminalSurface(id: string, ptyId: number) {
  return {
    kind: "terminal" as const,
    id,
    terminal: {} as never,
    fitAddon: {} as never,
    searchAddon: {} as never,
    termElement: document.createElement("div"),
    ptyId,
    title: id,
    hasUnread: false,
    opened: false,
  };
}

function makeWorkspace(id: string, ptyIds: number[]): NestedWorkspace {
  const surfaces = ptyIds.map((ptyId, i) =>
    makeTerminalSurface(`${id}-s${i}`, ptyId),
  );
  return {
    id,
    name: id,
    splitRoot: {
      type: "pane",
      pane: {
        id: `${id}-p`,
        surfaces,
        activeSurfaceId: surfaces[0]?.id ?? null,
      },
    },
    activePaneId: `${id}-p`,
  } as NestedWorkspace;
}

describe("quit-confirmation-service", () => {
  beforeEach(() => {
    askMock.mockReset();
    nestedWorkspaces.set([]);
  });

  describe("countLiveTerminals", () => {
    it("returns 0 when no workspaces exist", () => {
      expect(countLiveTerminals()).toBe(0);
    });

    it("counts only terminals with ptyId >= 0", () => {
      nestedWorkspaces.set([
        makeWorkspace("w1", [3, -1, 7]),
        makeWorkspace("w2", [-1]),
        makeWorkspace("w3", [12]),
      ]);
      expect(countLiveTerminals()).toBe(3);
    });
  });

  describe("confirmQuit", () => {
    it("does not call ask when no terminals are live", async () => {
      nestedWorkspaces.set([makeWorkspace("w1", [-1])]);
      const result = await confirmQuit();
      expect(result).toBe(true);
      expect(askMock).not.toHaveBeenCalled();
    });

    it("calls ask with the terminal count when terminals are live", async () => {
      nestedWorkspaces.set([
        makeWorkspace("w1", [1, 2]),
        makeWorkspace("w2", [3]),
      ]);
      askMock.mockResolvedValue(true);
      const result = await confirmQuit();
      expect(result).toBe(true);
      expect(askMock).toHaveBeenCalledTimes(1);
      const [message, options] = askMock.mock.calls[0]!;
      expect(message).toContain("3 terminals");
      expect(options).toEqual({ title: "Quit", kind: "warning" });
    });

    it("uses the singular form for exactly one live terminal", async () => {
      nestedWorkspaces.set([makeWorkspace("w1", [5])]);
      askMock.mockResolvedValue(true);
      await confirmQuit();
      const [message] = askMock.mock.calls[0]!;
      expect(message).toContain("1 terminal will be closed");
      expect(message).not.toContain("1 terminals");
    });

    it("returns false when the user cancels", async () => {
      nestedWorkspaces.set([makeWorkspace("w1", [5])]);
      askMock.mockResolvedValue(false);
      expect(await confirmQuit()).toBe(false);
    });

    it("returns false when the dialog promise rejects", async () => {
      nestedWorkspaces.set([makeWorkspace("w1", [5])]);
      askMock.mockRejectedValue(new Error("dialog crashed"));
      expect(await confirmQuit()).toBe(false);
    });
  });
});
