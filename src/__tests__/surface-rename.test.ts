import { readFileSync } from "fs";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(),
  isMac: false,
}));

import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/nested-workspace";
import { renamingSurfaceId } from "../lib/stores/ui";
import {
  renameActiveSurface,
  renameSurface,
} from "../lib/services/surface-service";
import type { NestedWorkspace } from "../lib/types";

function makeNestedWorkspace(
  surfaceId: string,
  title = "Tab",
): NestedWorkspace {
  return {
    id: "ws-1",
    name: "Test",
    activePaneId: "pane-1",
    splitRoot: {
      type: "pane",
      pane: {
        id: "pane-1",
        surfaces: [
          {
            kind: "extension",
            id: surfaceId,
            surfaceTypeId: "test",
            title,
            hasUnread: false,
          },
        ],
        activeSurfaceId: surfaceId,
      },
    },
  };
}

function makeNestedWorkspaceWithTerminal(
  surfaceId: string,
  title = "Terminal",
): NestedWorkspace {
  return {
    id: "ws-1",
    name: "Test",
    activePaneId: "pane-1",
    splitRoot: {
      type: "pane",
      pane: {
        id: "pane-1",
        surfaces: [
          {
            kind: "terminal",
            id: surfaceId,
            title,
            hasUnread: false,
            ptyId: 1,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            terminal: { dispose: () => {} } as any,
          },
        ],
        activeSurfaceId: surfaceId,
      },
    },
  };
}

describe("renameActiveSurface()", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    renamingSurfaceId.set(null);
  });

  it("does nothing when no active surface", () => {
    renameActiveSurface();
    expect(get(renamingSurfaceId)).toBeNull();
  });

  it("sets renamingSurfaceId to the active surface id", () => {
    nestedWorkspaces.set([makeNestedWorkspace("s-42")]);
    activeNestedWorkspaceIdx.set(0);
    renameActiveSurface();
    expect(get(renamingSurfaceId)).toBe("s-42");
  });
});

describe("renameSurface()", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("updates the surface title", () => {
    nestedWorkspaces.set([makeNestedWorkspace("s-42", "Original")]);
    renameSurface("s-42", "Renamed");
    const pane =
      get(nestedWorkspaces)[0].splitRoot.type === "pane"
        ? get(nestedWorkspaces)[0].splitRoot.pane
        : null;
    expect(pane?.surfaces[0].title).toBe("Renamed");
  });

  it("is a no-op for unknown surface id", () => {
    nestedWorkspaces.set([makeNestedWorkspace("s-42", "Original")]);
    renameSurface("unknown", "Changed");
    const pane =
      get(nestedWorkspaces)[0].splitRoot.type === "pane"
        ? get(nestedWorkspaces)[0].splitRoot.pane
        : null;
    expect(pane?.surfaces[0].title).toBe("Original");
  });

  it("stamps userDefinedTitle on terminal surfaces (Story 15)", () => {
    nestedWorkspaces.set([
      makeNestedWorkspaceWithTerminal("s-term", "Original"),
    ]);
    renameSurface("s-term", "MyName");
    const pane =
      get(nestedWorkspaces)[0].splitRoot.type === "pane"
        ? get(nestedWorkspaces)[0].splitRoot.pane
        : null;
    const surface = pane?.surfaces[0];
    expect(surface?.title).toBe("MyName");
    expect(
      surface?.kind === "terminal" ? surface.userDefinedTitle : undefined,
    ).toBe("MyName");
  });

  it("does NOT stamp userDefinedTitle on non-terminal surfaces (Story 15)", () => {
    nestedWorkspaces.set([makeNestedWorkspace("s-ext", "Original")]);
    renameSurface("s-ext", "Changed");
    const pane =
      get(nestedWorkspaces)[0].splitRoot.type === "pane"
        ? get(nestedWorkspaces)[0].splitRoot.pane
        : null;
    const surface = pane?.surfaces[0];
    expect(surface?.title).toBe("Changed");
    // userDefinedTitle is meaningful only for terminal surfaces (escape-seq target).
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (surface as any)?.userDefinedTitle,
    ).toBeUndefined();
  });
});

describe("keyboard-shortcuts: ⌘R wires to renameActiveSurface", () => {
  it("keyboard-shortcuts.ts imports renameActiveSurface", () => {
    const src = readFileSync("src/lib/services/keyboard-shortcuts.ts", "utf-8");
    expect(src).toMatch(/renameActiveSurface/);
  });
});

describe("Tab.svelte: rename wiring", () => {
  it("imports renamingSurfaceId", () => {
    const src = readFileSync("src/lib/components/Tab.svelte", "utf-8");
    expect(src).toMatch(/renamingSurfaceId/);
  });

  it("binds nameEl to the title span", () => {
    const src = readFileSync("src/lib/components/Tab.svelte", "utf-8");
    expect(src).toMatch(/bind:this={nameEl}/);
  });
});
