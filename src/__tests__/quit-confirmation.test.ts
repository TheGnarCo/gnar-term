/**
 * Tests for the quit-confirmation gate — counting live PTYs and confirming
 * before the window tears them down.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { workspaces } from "../lib/stores/workspace";
import { confirmPrompt } from "../lib/stores/ui";
import { countLiveTerminals, confirmQuit } from "../lib/services/quit-confirmation-service";
import type { Workspace, Pane, Surface, TerminalSurface } from "../lib/types";

function makeTerminal(id: string, ptyId: number): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: {} as any,
    fitAddon: {} as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId,
    title: id,
    hasUnread: false,
    opened: true,
  };
}

function makeWorkspace(id: string, surfaces: Surface[]): Workspace {
  const pane: Pane = { id: `${id}-p`, surfaces, activeSurfaceId: surfaces[0]?.id ?? null };
  return { id, name: id, splitRoot: { type: "pane", pane }, activePaneId: pane.id };
}

describe("quit-confirmation", () => {
  beforeEach(() => {
    workspaces.set([]);
    confirmPrompt.set(null);
  });

  it("counts only live terminals (ptyId >= 0) across all workspaces", () => {
    workspaces.set([
      makeWorkspace("a", [makeTerminal("a1", 5), makeTerminal("a2", -1)]),
      makeWorkspace("b", [makeTerminal("b1", 0)]),
    ]);
    expect(countLiveTerminals()).toBe(2);
  });

  it("ignores preview surfaces when counting", () => {
    const preview: Surface = {
      kind: "preview",
      id: "p1",
      filePath: "/tmp/x.md",
      title: "x.md",
      watchId: 0,
      hasUnread: false,
    };
    workspaces.set([makeWorkspace("a", [makeTerminal("a1", 3), preview])]);
    expect(countLiveTerminals()).toBe(1);
  });

  it("confirmQuit resolves true immediately with no prompt when nothing is live", async () => {
    workspaces.set([makeWorkspace("a", [makeTerminal("a1", -1)])]);
    const result = await confirmQuit();
    expect(result).toBe(true);
    expect(get(confirmPrompt)).toBeNull();
  });

  it("confirmQuit shows a prompt and resolves true when the user confirms", async () => {
    workspaces.set([makeWorkspace("a", [makeTerminal("a1", 1)])]);
    const promise = confirmQuit();
    const prompt = get(confirmPrompt);
    expect(prompt).not.toBeNull();
    expect(prompt!.message).toContain("1 terminal");
    prompt!.resolve(true);
    await expect(promise).resolves.toBe(true);
  });

  it("confirmQuit resolves false when the user cancels", async () => {
    workspaces.set([
      makeWorkspace("a", [makeTerminal("a1", 1), makeTerminal("a2", 2)]),
    ]);
    const promise = confirmQuit();
    const prompt = get(confirmPrompt);
    expect(prompt!.message).toContain("2 terminals");
    prompt!.resolve(false);
    await expect(promise).resolves.toBe(false);
  });
});
