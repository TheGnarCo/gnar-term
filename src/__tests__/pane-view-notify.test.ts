/**
 * Tests for PaneView notification chrome (Option E hybrid):
 * - Persistent notify-colored border + corner pip while any surface in
 *   the pane has hasUnread.
 * - mousedown on the pane focuses it AND clears hasUnread on its surfaces.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// JSDOM doesn't ship ResizeObserver — PaneView observes its own size for
// terminal fit. A noop stub is enough; we never assert on resize behavior.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

import PaneView from "../lib/components/PaneView.svelte";
import { workspaces } from "../lib/stores/workspace";
import type { Workspace, Pane, TerminalSurface } from "../lib/types";

function makeTerminalSurface(id: string, hasUnread: boolean): TerminalSurface {
  return {
    kind: "terminal",
    id,
    title: id,
    cwd: "/tmp",
    ptyId: -1,
    hasUnread,
    opened: false,
    notification: hasUnread ? "test notification" : undefined,
    // Stub fields the component reads but that we don't drive in this test
    terminal: {
      options: {},
      open: vi.fn(),
      loadAddon: vi.fn(),
      onData: vi.fn(),
      write: vi.fn(),
      dispose: vi.fn(),
      onScroll: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      buffer: { active: { getLine: vi.fn(), length: 0 } },
      rows: 24,
    } as unknown as TerminalSurface["terminal"],
    fitAddon: { fit: vi.fn() } as unknown as TerminalSurface["fitAddon"],
    searchAddon: {} as unknown as TerminalSurface["searchAddon"],
    termElement: document.createElement("div"),
  } as TerminalSurface;
}

function makePane(surfaces: TerminalSurface[]): Pane {
  return {
    id: "p1",
    surfaces,
    activeSurfaceId: surfaces[0]?.id ?? null,
  };
}

function setupWorkspace(pane: Pane): Workspace {
  const ws: Workspace = {
    id: "ws1",
    name: "Test",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
  workspaces.set([ws]);
  return ws;
}

const noop = () => {};

describe("PaneView notification chrome", () => {
  afterEach(() => {
    cleanup();
    workspaces.set([]);
  });

  it("renders default border when no surface in the pane has hasUnread", () => {
    const surface = makeTerminalSurface("s1", false);
    const pane = makePane([surface]);
    setupWorkspace(pane);

    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: "ws1",
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });

    const root = container.firstChild as HTMLElement;
    expect(root.dataset.unread).toBeUndefined();
    expect(root.style.border).not.toContain("rgb(88, 166, 255)");
    // No corner pip
    expect(
      container.querySelector('[title="New activity in this pane"]'),
    ).toBeNull();
  });

  it("renders notify-colored border + corner pip when a surface has hasUnread", () => {
    const unread = makeTerminalSurface("s1", true);
    const pane = makePane([unread]);
    setupWorkspace(pane);

    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: "ws1",
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });

    const root = container.firstChild as HTMLElement;
    expect(root.dataset.unread).toBe("true");
    // The default github-dark theme.notify is #58a6ff = rgb(88, 166, 255)
    expect(root.style.border).toContain("rgb(88, 166, 255)");
    // Corner pip is rendered
    const pip = container.querySelector('[title="New activity in this pane"]');
    expect(pip).not.toBeNull();
  });

  it("mousedown on the pane invokes onFocusPane AND clears hasUnread on its surfaces", async () => {
    const unread1 = makeTerminalSurface("s1", true);
    const unread2 = makeTerminalSurface("s2", true);
    const pane = makePane([unread1, unread2]);
    setupWorkspace(pane);

    const onFocusPane = vi.fn();
    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: "ws1",
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane,
      },
    });

    const root = container.firstChild as HTMLElement;
    await fireEvent.mouseDown(root);

    expect(onFocusPane).toHaveBeenCalledTimes(1);
    expect(unread1.hasUnread).toBe(false);
    expect(unread2.hasUnread).toBe(false);
    expect(unread1.notification).toBeUndefined();
    // Store reference is also up to date (re-emitted via .update())
    const ws = get(workspaces)[0];
    const stored = ws?.splitRoot;
    if (stored && stored.type === "pane") {
      expect(stored.pane.surfaces.every((s) => !s.hasUnread)).toBe(true);
    }
  });

  it("mousedown on a pane with no unread still focuses without crashing", async () => {
    const surface = makeTerminalSurface("s1", false);
    const pane = makePane([surface]);
    setupWorkspace(pane);

    const onFocusPane = vi.fn();
    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: "ws1",
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane,
      },
    });

    const root = container.firstChild as HTMLElement;
    await fireEvent.mouseDown(root);
    expect(onFocusPane).toHaveBeenCalledTimes(1);
    expect(surface.hasUnread).toBe(false);
  });

  it("renders accent border when isActive is true and no surface has hasUnread", () => {
    const surface = makeTerminalSurface("s1", false);
    const pane = makePane([surface]);
    setupWorkspace(pane);

    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: "ws1",
        isActive: true,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });

    const root = container.firstChild as HTMLElement;
    // github-dark theme accent = #58a6ff = rgb(88, 166, 255)
    expect(root.style.border).toContain("rgb(88, 166, 255)");
    // No corner pip or glow when only isActive (no unread)
    expect(
      container.querySelector('[title="New activity in this pane"]'),
    ).toBeNull();
    expect(root.style.boxShadow).toBeFalsy();
  });

  it("renders default border when isActive is false and no surface has hasUnread", () => {
    const surface = makeTerminalSurface("s1", false);
    const pane = makePane([surface]);
    setupWorkspace(pane);

    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: "ws1",
        isActive: false,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });

    const root = container.firstChild as HTMLElement;
    expect(root.style.border).not.toContain("rgb(88, 166, 255)");
  });

  it("renders notify border (unread wins) when isActive is true and a surface has hasUnread", () => {
    const surface = makeTerminalSurface("s1", true);
    const pane = makePane([surface]);
    setupWorkspace(pane);

    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: "ws1",
        isActive: true,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });

    const root = container.firstChild as HTMLElement;
    expect(root.dataset.unread).toBe("true");
    // notify wins over accent — data-unread present means notify branch taken
    expect(root.style.border).toContain("rgb(88, 166, 255)");
    // Corner pip is only rendered when paneHasUnread is true — confirms the notify
    // branch (not the accent branch) determined the border color.
    const pip = container.querySelector('[title="New activity in this pane"]');
    expect(pip).not.toBeNull();
    // Box-shadow glow is also only set when paneHasUnread is true.
    expect(root.style.boxShadow).toBeTruthy();
  });
});
