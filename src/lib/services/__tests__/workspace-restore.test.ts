/**
 * Unit tests for S2 (last-active branch restore) and S9 (auto-run restore commands).
 *
 * S2 tests:
 *   1. switchNestedWorkspace records lastActiveNestedWorkspaceId on parent workspace
 *   2. switchNestedWorkspace does NOT record when nested has no parentWorkspaceId
 *   3. activateWorkspace prefers lastActiveNestedWorkspaceId over primaryNestedWorkspaceId
 *   4. activateWorkspace falls back to primaryNestedWorkspaceId when lastActive not set
 *
 * S9 tests:
 *   5. autoRunRestoreCommands=true → startupCommand set directly (not pendingRestoreCommand)
 *   6. autoRunRestoreCommands=false/unset → pendingRestoreCommand set (existing behavior)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../../stores/nested-workspace";
import {
  switchNestedWorkspace,
  createNestedWorkspaceFromDef,
} from "../nested-workspace-service";
import { activateWorkspace, addWorkspace } from "../workspace-service";
import { resetWorkspacesForTest, getWorkspace } from "../../stores/workspaces";
import { rootRowOrder } from "../../stores/root-row-order";
import type { NestedWorkspace } from "../../types";
import type { Workspace } from "../../config";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock terminal-service — createTerminalSurface returns a minimal mutable surface
// object so tests can inspect startupCommand / pendingRestoreCommand after
// createNestedWorkspaceFromDef runs.
vi.mock("../../terminal-service", () => ({
  createTerminalSurface: vi
    .fn()
    .mockImplementation(
      async (pane: { surfaces: unknown[]; activeSurfaceId: string | null }) => {
        const surface = {
          kind: "terminal" as const,
          id: `surf-${Math.random().toString(36).slice(2)}`,
          title: "Shell",
          hasUnread: false,
          opened: false,
          ptyId: -1,
          startupCommand: undefined as string | undefined,
          pendingRestoreCommand: undefined as true | undefined,
          definedCommand: undefined as string | undefined,
          // Minimal stub to satisfy safeFocus (isTerminalSurface → terminal.focus)
          terminal: { focus: vi.fn() },
        };
        pane.surfaces.push(surface);
        if (!pane.activeSurfaceId) pane.activeSurfaceId = surface.id;
        return surface;
      },
    ),
}));

// Minimal NestedWorkspace factory
function makeNested(id: string, parentWorkspaceId?: string): NestedWorkspace {
  return {
    id,
    name: id,
    splitRoot: {
      type: "pane",
      pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: `${id}-p`,
    ...(parentWorkspaceId ? { metadata: { parentWorkspaceId } } : {}),
  } as NestedWorkspace;
}

function makeWorkspace(
  id: string,
  overrides: Partial<Workspace> = {},
): Workspace {
  return {
    id,
    name: `Workspace ${id}`,
    path: `/tmp/${id}`,
    color: "slot-1",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("S2 — last-active branch restore", () => {
  beforeEach(() => {
    resetWorkspacesForTest();
    rootRowOrder.set([]);
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("switchNestedWorkspace records lastActiveNestedWorkspaceId on parent workspace", () => {
    const ws = makeWorkspace("g1", { nestedWorkspaceIds: ["nw-a", "nw-b"] });
    addWorkspace(ws);

    nestedWorkspaces.set([makeNested("nw-a", "g1"), makeNested("nw-b", "g1")]);

    switchNestedWorkspace(1); // switch to index 1 → nw-b

    expect(getWorkspace("g1")?.lastActiveNestedWorkspaceId).toBe("nw-b");
  });

  it("switchNestedWorkspace does NOT record lastActiveNestedWorkspaceId when nested has no parentWorkspaceId", () => {
    const ws = makeWorkspace("g1");
    addWorkspace(ws);

    nestedWorkspaces.set([makeNested("nw-root")]); // no parentWorkspaceId

    switchNestedWorkspace(0);

    // g1 should remain untouched — nw-root has no parentWorkspaceId
    expect(getWorkspace("g1")?.lastActiveNestedWorkspaceId).toBeUndefined();
  });

  it("activateWorkspace prefers lastActiveNestedWorkspaceId over primaryNestedWorkspaceId when both exist", async () => {
    const ws = makeWorkspace("g1", {
      nestedWorkspaceIds: ["nw-primary", "nw-last"],
      primaryNestedWorkspaceId: "nw-primary",
      lastActiveNestedWorkspaceId: "nw-last",
    });
    addWorkspace(ws);

    nestedWorkspaces.set([
      makeNested("nw-primary", "g1"),
      makeNested("nw-last", "g1"),
    ]);
    activeNestedWorkspaceIdx.set(-1);

    await activateWorkspace("g1");

    const idx = get(activeNestedWorkspaceIdx);
    const active = get(nestedWorkspaces)[idx];
    expect(active?.id).toBe("nw-last");
  });

  it("activateWorkspace falls back to primaryNestedWorkspaceId when lastActiveNestedWorkspaceId is not set", async () => {
    const ws = makeWorkspace("g1", {
      nestedWorkspaceIds: ["nw-primary"],
      primaryNestedWorkspaceId: "nw-primary",
    });
    addWorkspace(ws);

    nestedWorkspaces.set([makeNested("nw-primary", "g1")]);
    activeNestedWorkspaceIdx.set(-1);

    await activateWorkspace("g1");

    const idx = get(activeNestedWorkspaceIdx);
    const active = get(nestedWorkspaces)[idx];
    expect(active?.id).toBe("nw-primary");
  });
});

describe("S9 — auto-run restore commands", () => {
  beforeEach(() => {
    resetWorkspacesForTest();
    rootRowOrder.set([]);
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    vi.clearAllMocks();
  });

  it("sets startupCommand directly when autoRunRestoreCommands is true on parent workspace", async () => {
    const ws = makeWorkspace("g1", { autoRunRestoreCommands: true });
    addWorkspace(ws);

    await createNestedWorkspaceFromDef(
      {
        name: "Test",
        cwd: "/tmp",
        metadata: { parentWorkspaceId: "g1" },
        layout: {
          pane: {
            surfaces: [{ command: "echo hello" }],
          },
        },
      },
      { restoring: true },
    );

    const allNestedWs = get(nestedWorkspaces);
    const createdWs = allNestedWs[allNestedWs.length - 1]!;
    const pane =
      createdWs.splitRoot.type === "pane" ? createdWs.splitRoot.pane : null;
    expect(pane).not.toBeNull();
    const surface = pane!.surfaces[0] as {
      startupCommand?: string;
      pendingRestoreCommand?: true;
    };
    expect(surface.startupCommand).toBe("echo hello");
    expect(surface.pendingRestoreCommand).toBeUndefined();
  });

  it("sets pendingRestoreCommand when autoRunRestoreCommands is false/unset on parent workspace", async () => {
    const ws = makeWorkspace("g1"); // autoRunRestoreCommands not set
    addWorkspace(ws);

    await createNestedWorkspaceFromDef(
      {
        name: "Test",
        cwd: "/tmp",
        metadata: { parentWorkspaceId: "g1" },
        layout: {
          pane: {
            surfaces: [{ command: "echo hello" }],
          },
        },
      },
      { restoring: true },
    );

    const allNestedWs = get(nestedWorkspaces);
    const createdWs = allNestedWs[allNestedWs.length - 1]!;
    const pane =
      createdWs.splitRoot.type === "pane" ? createdWs.splitRoot.pane : null;
    expect(pane).not.toBeNull();
    const surface = pane!.surfaces[0] as {
      startupCommand?: string;
      pendingRestoreCommand?: true;
    };
    expect(surface.pendingRestoreCommand).toBe(true);
    expect(surface.startupCommand).toBeUndefined();
  });
});
