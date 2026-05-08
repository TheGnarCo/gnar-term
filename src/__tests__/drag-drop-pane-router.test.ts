/**
 * Tests for drag-drop-pane-router — Tauri-native drag-drop is window-wide,
 * so the router must dispatch to the pane under the cursor (not all visible
 * panes) and manage hover-to-activate / restore-on-cancel.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const listeners: Record<string, ((e: unknown) => void) | undefined> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: unknown) => void) => {
    listeners[name] = cb;
    return () => {
      delete listeners[name];
    };
  }),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeImage: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { initDragDropPaneRouter } from "../lib/services/drag-drop-pane-router";
import type { Workspace } from "../lib/types";

const invokeMock = vi.mocked(invoke);
const writeImageMock = vi.mocked(writeImage);

function makeWorkspaceWithTwoPanes(): Workspace {
  return {
    id: "ws-1",
    name: "Test",
    activePaneId: "pane-A",
    paneLayout: {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        {
          type: "pane",
          pane: {
            id: "pane-A",
            activeSurfaceId: "surf-A",
            surfaces: [
              {
                kind: "terminal",
                id: "surf-A",
                title: "A",
                hasUnread: false,
                ptyId: 100,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                terminal: { dispose: () => {} } as any,
              },
            ],
          },
        },
        {
          type: "pane",
          pane: {
            id: "pane-B",
            activeSurfaceId: "surf-B",
            surfaces: [
              {
                kind: "terminal",
                id: "surf-B",
                title: "B",
                hasUnread: false,
                ptyId: 200,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                terminal: { dispose: () => {} } as any,
              },
            ],
          },
        },
      ],
    },
  };
}

/** Insert fake pane elements into the DOM and stub elementFromPoint. */
function setupPaneElements(panes: { id: string; rect: DOMRect }[]): void {
  while (document.body.firstChild)
    document.body.removeChild(document.body.firstChild);
  for (const p of panes) {
    const el = document.createElement("div");
    el.setAttribute("data-pane-body", p.id);
    document.body.appendChild(el);
    el.getBoundingClientRect = () => p.rect;
  }
  document.elementFromPoint = (x: number, y: number) => {
    for (const p of panes) {
      if (
        x >= p.rect.left &&
        x <= p.rect.right &&
        y >= p.rect.top &&
        y <= p.rect.bottom
      ) {
        return document.querySelector(`[data-pane-body="${p.id}"]`);
      }
    }
    return null;
  };
}

describe("drag-drop-pane-router", () => {
  beforeEach(async () => {
    for (const k of Object.keys(listeners)) delete listeners[k];
    invokeMock.mockClear();
    writeImageMock.mockClear();
    workspaces.set([makeWorkspaceWithTwoPanes()]);
    activeWorkspaceIdx.set(0);
    setupPaneElements([
      { id: "pane-A", rect: new DOMRect(0, 0, 100, 100) },
      { id: "pane-B", rect: new DOMRect(100, 0, 100, 100) },
    ]);
    await initDragDropPaneRouter();
  });

  it("dispatches drop only to the pane under the cursor", async () => {
    listeners["tauri://drag-drop"]!({
      payload: { paths: ["/tmp/screenshot.png"], position: { x: 150, y: 50 } },
    });
    // Allow the writeImage promise chain to settle before write_pty fires.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(writeImageMock).toHaveBeenCalledWith("/tmp/screenshot.png");
    const writePtyCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "write_pty",
    );
    expect(writePtyCalls).toHaveLength(1);
    expect(writePtyCalls[0]![1]).toMatchObject({ ptyId: 200, data: "\x16" });
  });

  it("ignores drops that fall outside any pane", async () => {
    listeners["tauri://drag-drop"]!({
      payload: { paths: ["/tmp/screenshot.png"], position: { x: 999, y: 999 } },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(writeImageMock).not.toHaveBeenCalled();
    expect(
      invokeMock.mock.calls.filter((c) => c[0] === "write_pty"),
    ).toHaveLength(0);
  });

  it("activates the pane under the cursor on drag-over", () => {
    listeners["tauri://drag-enter"]!({
      payload: { paths: [], position: { x: 50, y: 50 } },
    });
    expect(get(workspaces)[0]!.activePaneId).toBe("pane-A");
    listeners["tauri://drag-over"]!({
      payload: { position: { x: 150, y: 50 } },
    });
    expect(get(workspaces)[0]!.activePaneId).toBe("pane-B");
  });

  it("restores the original active pane when drag leaves the window", () => {
    listeners["tauri://drag-enter"]!({
      payload: { paths: [], position: { x: 50, y: 50 } },
    });
    listeners["tauri://drag-over"]!({
      payload: { position: { x: 150, y: 50 } },
    });
    expect(get(workspaces)[0]!.activePaneId).toBe("pane-B");

    listeners["tauri://drag-leave"]!({ payload: {} });
    expect(get(workspaces)[0]!.activePaneId).toBe("pane-A");
  });

  it("restores original active when drag-over moves off all panes", () => {
    listeners["tauri://drag-enter"]!({
      payload: { paths: [], position: { x: 150, y: 50 } },
    });
    expect(get(workspaces)[0]!.activePaneId).toBe("pane-B");
    listeners["tauri://drag-over"]!({
      payload: { position: { x: 999, y: 999 } },
    });
    expect(get(workspaces)[0]!.activePaneId).toBe("pane-A");
  });

  it("keeps the dropped-on pane active after a successful drop", async () => {
    listeners["tauri://drag-enter"]!({
      payload: { paths: [], position: { x: 150, y: 50 } },
    });
    listeners["tauri://drag-drop"]!({
      payload: { paths: ["/tmp/x.png"], position: { x: 150, y: 50 } },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(get(workspaces)[0]!.activePaneId).toBe("pane-B");
  });

  it("sends shell-escaped path for non-image drops", async () => {
    listeners["tauri://drag-drop"]!({
      payload: { paths: ["/tmp/foo.txt"], position: { x: 150, y: 50 } },
    });
    await new Promise((r) => setTimeout(r, 0));
    const writePty = invokeMock.mock.calls.find((c) => c[0] === "write_pty");
    expect(writePty).toBeDefined();
    const data = (writePty![1] as Record<string, unknown>).data as string;
    expect(data).toContain("foo.txt");
    expect(data).not.toBe("\x16");
  });
});
