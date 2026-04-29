/**
 * Tier 3 session restore — behavior tests.
 *
 * Covers: restore vs fresh creation flag plumbing, runDefinedCommand,
 * dismissDefinedCommand, the inline RestoreCommandPrompt visibility, and
 * the bulk RestoreCommandsOverlay listing/buttons.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: class {
    onmessage: ((m: unknown) => void) | undefined = undefined;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    open = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    cols = 80;
    rows = 24;
    onData = vi.fn();
    onResize = vi.fn();
    onTitleChange = vi.fn();
    loadAddon = vi.fn();
    options: Record<string, unknown> = {};
    buffer = { active: { getLine: vi.fn(), length: 0 } };
    parser = { registerOscHandler: vi.fn() };
    attachCustomKeyEventHandler = vi.fn();
    registerLinkProvider = vi.fn();
    getSelection = vi.fn();
    hasSelection = vi.fn().mockReturnValue(false);
    onSelectionChange = vi.fn();
    scrollToBottom = vi.fn();
    clear = vi.fn();
    onScroll = vi.fn().mockReturnValue({ dispose: vi.fn() });
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    activate = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
    onContextLoss = vi.fn();
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
    clearDecorations = vi.fn();
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

import { invoke } from "@tauri-apps/api/core";
import {
  createWorkspaceFromDef,
  serializeLayout,
} from "../lib/services/workspace-service";
import {
  runDefinedCommand,
  dismissDefinedCommand,
} from "../lib/terminal-service";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  getAllPanes,
  isTerminalSurface,
  type TerminalSurface,
  type Workspace,
  type Pane,
} from "../lib/types";
import RestoreCommandPrompt from "../lib/components/RestoreCommandPrompt.svelte";
import RestoreCommandsOverlay from "../lib/components/RestoreCommandsOverlay.svelte";

function firstTerminalSurface(ws: Workspace): TerminalSurface {
  for (const pane of getAllPanes(ws.splitRoot)) {
    for (const s of pane.surfaces) {
      if (isTerminalSurface(s)) return s;
    }
  }
  throw new Error("no terminal surface");
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  // Default: spawn_pty resolves with a fresh ptyId; everything else returns undefined.
  let nextPty = 100;
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "spawn_pty") return Promise.resolve(nextPty++);
    return Promise.resolve(undefined as unknown);
  });
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
});

afterEach(() => {
  cleanup();
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
});

describe("createWorkspaceFromDef — restore vs fresh", () => {
  it("restored surface gets definedCommand + pendingRestoreCommand, NOT startupCommand", async () => {
    await createWorkspaceFromDef(
      {
        name: "Restored",
        layout: {
          pane: {
            surfaces: [
              { type: "terminal", cwd: "/tmp", command: "npm run dev" },
            ],
          },
        },
      },
      { restoring: true },
    );
    const ws = get(workspaces)[0]!;
    const s = firstTerminalSurface(ws);
    expect(s.definedCommand).toBe("npm run dev");
    expect(s.pendingRestoreCommand).toBe(true);
    expect(s.startupCommand).toBeUndefined();
  });

  it("fresh-created surface with a command gets all three (definedCommand + startupCommand, NOT pending)", async () => {
    await createWorkspaceFromDef({
      name: "Fresh",
      layout: {
        pane: {
          surfaces: [{ type: "terminal", cwd: "/tmp", command: "ls -la" }],
        },
      },
    });
    const ws = get(workspaces)[0]!;
    const s = firstTerminalSurface(ws);
    expect(s.definedCommand).toBe("ls -la");
    expect(s.startupCommand).toBe("ls -la");
    expect(s.pendingRestoreCommand).toBeFalsy();
  });

  it("round-trips: serialized output of a restored workspace still carries `command`", async () => {
    await createWorkspaceFromDef(
      {
        name: "Restored",
        layout: {
          pane: {
            surfaces: [{ type: "terminal", command: "npm test" }],
          },
        },
      },
      { restoring: true },
    );
    const ws = get(workspaces)[0]!;
    const layout = serializeLayout(ws.splitRoot) as {
      pane: { surfaces: Array<Record<string, unknown>> };
    };
    expect(layout.pane.surfaces[0]!.command).toBe("npm test");
  });
});

describe("runDefinedCommand / dismissDefinedCommand", () => {
  function makeSurface(
    overrides: Partial<TerminalSurface> = {},
  ): TerminalSurface {
    return {
      kind: "terminal",
      id: "s1",
      terminal: {} as unknown as TerminalSurface["terminal"],
      fitAddon: {} as unknown as TerminalSurface["fitAddon"],
      searchAddon: {} as unknown as TerminalSurface["searchAddon"],
      termElement: document.createElement("div"),
      ptyId: 42,
      title: "shell",
      hasUnread: false,
      opened: true,
      definedCommand: "npm test",
      pendingRestoreCommand: true,
      ...overrides,
    };
  }

  function attachToStore(surface: TerminalSurface): void {
    const pane: Pane = {
      id: "p1",
      surfaces: [surface],
      activeSurfaceId: surface.id,
    };
    workspaces.set([
      {
        id: "ws1",
        name: "ws",
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      },
    ]);
  }

  it("runDefinedCommand writes the command to the PTY and clears pendingRestoreCommand", async () => {
    const s = makeSurface();
    attachToStore(s);
    await runDefinedCommand(s);
    expect(invoke).toHaveBeenCalledWith("write_pty", {
      ptyId: 42,
      data: "npm test\n",
    });
    expect(s.pendingRestoreCommand).toBe(false);
    expect(s.definedCommand).toBe("npm test");
  });

  it("runDefinedCommand is a no-op when ptyId < 0", async () => {
    const s = makeSurface({ ptyId: -1 });
    attachToStore(s);
    await runDefinedCommand(s);
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_pty");
    expect(writes).toHaveLength(0);
    expect(s.pendingRestoreCommand).toBe(true);
  });

  it("runDefinedCommand is a no-op when pendingRestoreCommand is already false", async () => {
    const s = makeSurface({ pendingRestoreCommand: false });
    attachToStore(s);
    await runDefinedCommand(s);
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_pty");
    expect(writes).toHaveLength(0);
  });

  it("dismissDefinedCommand clears pendingRestoreCommand but keeps definedCommand", () => {
    const s = makeSurface();
    attachToStore(s);
    dismissDefinedCommand(s);
    expect(s.pendingRestoreCommand).toBe(false);
    expect(s.definedCommand).toBe("npm test");
  });
});

describe("RestoreCommandPrompt", () => {
  function makeSurface(
    overrides: Partial<TerminalSurface> = {},
  ): TerminalSurface {
    return {
      kind: "terminal",
      id: "s1",
      terminal: {} as unknown as TerminalSurface["terminal"],
      fitAddon: {} as unknown as TerminalSurface["fitAddon"],
      searchAddon: {} as unknown as TerminalSurface["searchAddon"],
      termElement: document.createElement("div"),
      ptyId: 7,
      title: "shell",
      hasUnread: false,
      opened: true,
      ...overrides,
    };
  }

  it("renders only when pendingRestoreCommand is true", () => {
    const surface = makeSurface({
      definedCommand: "echo hi",
      pendingRestoreCommand: true,
    });
    const { container } = render(RestoreCommandPrompt, { props: { surface } });
    expect(container.textContent).toContain("Last session ran");
    expect(container.textContent).toContain("echo hi");
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("renders nothing when pendingRestoreCommand is falsy", () => {
    const surface = makeSurface({
      definedCommand: "echo hi",
      pendingRestoreCommand: false,
    });
    const { container } = render(RestoreCommandPrompt, { props: { surface } });
    expect(container.textContent ?? "").not.toContain("Last session ran");
  });

  it("renders nothing when definedCommand is missing", () => {
    const surface = makeSurface({ pendingRestoreCommand: true });
    const { container } = render(RestoreCommandPrompt, { props: { surface } });
    expect(container.textContent ?? "").not.toContain("Last session ran");
  });
});

describe("RestoreCommandsOverlay", () => {
  function setupTwoPending(): {
    a: TerminalSurface;
    b: TerminalSurface;
  } {
    const a: TerminalSurface = {
      kind: "terminal",
      id: "sa",
      terminal: {} as unknown as TerminalSurface["terminal"],
      fitAddon: {} as unknown as TerminalSurface["fitAddon"],
      searchAddon: {} as unknown as TerminalSurface["searchAddon"],
      termElement: document.createElement("div"),
      ptyId: 11,
      title: "a",
      hasUnread: false,
      opened: true,
      definedCommand: "npm run dev",
      pendingRestoreCommand: true,
    };
    const b: TerminalSurface = {
      kind: "terminal",
      id: "sb",
      terminal: {} as unknown as TerminalSurface["terminal"],
      fitAddon: {} as unknown as TerminalSurface["fitAddon"],
      searchAddon: {} as unknown as TerminalSurface["searchAddon"],
      termElement: document.createElement("div"),
      ptyId: 22,
      title: "b",
      hasUnread: false,
      opened: true,
      definedCommand: "npm test",
      pendingRestoreCommand: true,
    };
    workspaces.set([
      {
        id: "ws1",
        name: "Alpha",
        splitRoot: {
          type: "pane",
          pane: { id: "p1", surfaces: [a], activeSurfaceId: a.id },
        },
        activePaneId: "p1",
      },
      {
        id: "ws2",
        name: "Beta",
        splitRoot: {
          type: "pane",
          pane: { id: "p2", surfaces: [b], activeSurfaceId: b.id },
        },
        activePaneId: "p2",
      },
    ]);
    return { a, b };
  }

  it("lists every pending surface with a checkbox checked by default", () => {
    setupTwoPending();
    const { container, getAllByTestId } = render(RestoreCommandsOverlay, {
      props: { onClose: vi.fn() },
    });
    const checkboxes = getAllByTestId(
      "restore-row-checkbox",
    ) as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((c) => c.checked)).toBe(true);
    expect(container.textContent).toContain("npm run dev");
    expect(container.textContent).toContain("npm test");
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Beta");
  });

  it("'Restore selected' runs only checked rows; unchecked rows get dismissed", async () => {
    const { a, b } = setupTwoPending();
    const onClose = vi.fn();
    const { getAllByTestId, getByText } = render(RestoreCommandsOverlay, {
      props: { onClose },
    });
    const checkboxes = getAllByTestId(
      "restore-row-checkbox",
    ) as HTMLInputElement[];
    // Uncheck the second row.
    await fireEvent.click(checkboxes[1]!);
    await fireEvent.click(getByText("Restore selected"));

    // Allow microtasks (waitForPtyReady + write_pty) to flush.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_pty");
    expect(writes).toHaveLength(1);
    expect(writes[0]![1]).toEqual({ ptyId: 11, data: "npm run dev\n" });
    expect(a.pendingRestoreCommand).toBe(false);
    expect(b.pendingRestoreCommand).toBe(false);
    // definedCommand is preserved on both regardless.
    expect(a.definedCommand).toBe("npm run dev");
    expect(b.definedCommand).toBe("npm test");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("'Skip all' dismisses everything and writes no commands", async () => {
    const { a, b } = setupTwoPending();
    const onClose = vi.fn();
    const { getByText } = render(RestoreCommandsOverlay, {
      props: { onClose },
    });
    await fireEvent.click(getByText("Skip all"));

    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_pty");
    expect(writes).toHaveLength(0);
    expect(a.pendingRestoreCommand).toBe(false);
    expect(b.pendingRestoreCommand).toBe(false);
    expect(a.definedCommand).toBe("npm run dev");
    expect(b.definedCommand).toBe("npm test");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("'Restore all' writes every command without consulting checkboxes", async () => {
    const { a, b } = setupTwoPending();
    const { getByText, getAllByTestId } = render(RestoreCommandsOverlay, {
      props: { onClose: vi.fn() },
    });
    // Uncheck both — Restore all should ignore checkbox state.
    const checkboxes = getAllByTestId(
      "restore-row-checkbox",
    ) as HTMLInputElement[];
    await fireEvent.click(checkboxes[0]!);
    await fireEvent.click(checkboxes[1]!);
    await fireEvent.click(getByText("Restore all"));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_pty");
    expect(writes).toHaveLength(2);
    expect(a.pendingRestoreCommand).toBe(false);
    expect(b.pendingRestoreCommand).toBe(false);
  });
});
