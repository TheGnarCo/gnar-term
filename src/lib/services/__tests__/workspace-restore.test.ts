/**
 * Unit tests for S2 (last-active branch tracking) and S9 (auto-run restore commands).
 *
 * S2 tests:
 *   1. switchWorkspace records lastActiveBranchedWorkspaceId on parent workspace
 *   2. switchWorkspace does NOT record when child has no rootWorkspaceId
 *   3. activateWorkspace lands on the Workspace's own Root (the runtime
 *      workspace whose id matches the Record id) even when
 *      lastActiveBranchedWorkspaceId points at a sibling Branch. lastActive
 *      is preserved as a tracking field but does NOT route row activations.
 *   4. activateWorkspace materializes a Root runtime workspace at the
 *      Record's id when none exists yet (lazy materialization on click).
 *
 * S9 tests:
 *   5. autoRunRestoreCommands=true → startupCommand set directly (not pendingRestoreCommand)
 *   6. autoRunRestoreCommands=undefined → startupCommand set (opt-out default)
 *   7. autoRunRestoreCommands=false → pendingRestoreCommand set (explicit opt-out)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import { workspaces, activeWorkspaceIdx } from "../../stores/workspace";
import {
  switchWorkspace,
  createWorkspaceFromDef,
} from "../workspace-runtime-service";
import { activateWorkspace, addWorkspace } from "../workspace-service";
import { resetWorkspacesForTest, getWorkspace } from "../../stores/workspace";
import { rootRowOrder } from "../../stores/root-row-order";
import type { Workspace } from "../../types";
import type { WorkspaceRecord } from "../../config";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock terminal-service — createTerminalSurface returns a minimal mutable surface
// object so tests can inspect startupCommand / pendingRestoreCommand after
// createWorkspaceFromDef runs.
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

// Minimal Workspace factory
function makeChild(id: string, rootWorkspaceId?: string): Workspace {
  return {
    id,
    name: id,
    paneLayout: {
      type: "pane",
      pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: `${id}-p`,
    ...(rootWorkspaceId ? { rootWorkspaceId } : {}),
  } as Workspace;
}

function makeWorkspace(
  id: string,
  overrides: Partial<WorkspaceRecord> = {},
): WorkspaceRecord {
  return {
    id,
    name: `Workspace ${id}`,
    path: `/tmp/${id}`,
    color: "slot-1",
    branchedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("S2 — last-active branch restore", () => {
  beforeEach(() => {
    resetWorkspacesForTest();
    rootRowOrder.set([]);
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("switchWorkspace records lastActiveBranchedWorkspaceId on parent workspace", () => {
    const ws = makeWorkspace("g1", { branchedWorkspaceIds: ["nw-a", "nw-b"] });
    addWorkspace(ws);

    // Append the children alongside g1 (don't clobber — Stage 10 unified store
    // keeps both workspace and branch rows in `workspaces`).
    workspaces.update((cur) => [
      ...cur,
      makeChild("nw-a", "g1"),
      makeChild("nw-b", "g1"),
    ]);

    // After addWorkspace, g1 is at idx 0; nw-a at 1; nw-b at 2.
    switchWorkspace(2);

    expect(getWorkspace("g1")?.lastActiveBranchedWorkspaceId).toBe("nw-b");
  });

  it("switchWorkspace does NOT record lastActiveBranchedWorkspaceId when child has no rootWorkspaceId", () => {
    const ws = makeWorkspace("g1");
    addWorkspace(ws);

    workspaces.update((cur) => [...cur, makeChild("nw-root")]); // no rootWorkspaceId

    switchWorkspace(1);

    // g1 should remain untouched — nw-root has no rootWorkspaceId
    expect(getWorkspace("g1")?.lastActiveBranchedWorkspaceId).toBeUndefined();
  });

  it("activateWorkspace lands on the Workspace's own Root even when lastActiveBranchedWorkspaceId points at a Branch", async () => {
    const ws = makeWorkspace("g1", {
      branchedWorkspaceIds: ["nw-last"],
      lastActiveBranchedWorkspaceId: "nw-last",
    });
    addWorkspace(ws);

    workspaces.update((cur) => [...cur, makeChild("nw-last", "g1")]);
    activeWorkspaceIdx.set(-1);

    await activateWorkspace("g1");

    const idx = get(activeWorkspaceIdx);
    const active = get(workspaces)[idx];
    expect(active?.id).toBe("g1");
  });

  it("activateWorkspace materializes a Root runtime workspace when none exists yet", async () => {
    const ws = makeWorkspace("g1");
    addWorkspace(ws);

    activeWorkspaceIdx.set(-1);

    await activateWorkspace("g1");

    const idx = get(activeWorkspaceIdx);
    const active = get(workspaces)[idx];
    expect(active?.id).toBe("g1");
  });
});

describe("S9 — auto-run restore commands", () => {
  beforeEach(() => {
    resetWorkspacesForTest();
    rootRowOrder.set([]);
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    vi.clearAllMocks();
  });

  it("sets startupCommand directly when autoRunRestoreCommands is true on parent workspace", async () => {
    const ws = makeWorkspace("g1", { autoRunRestoreCommands: true });
    addWorkspace(ws);

    await createWorkspaceFromDef(
      {
        name: "Test",
        cwd: "/tmp",
        metadata: { rootWorkspaceId: "g1" },
        layout: {
          pane: {
            surfaces: [{ command: "echo hello" }],
          },
        },
      },
      { restoring: true },
    );

    const allChildWs = get(workspaces);
    const createdWs = allChildWs[allChildWs.length - 1]!;
    const pane =
      createdWs.paneLayout.type === "pane" ? createdWs.paneLayout.pane : null;
    expect(pane).not.toBeNull();
    const surface = pane!.surfaces[0] as {
      startupCommand?: string;
      pendingRestoreCommand?: true;
    };
    expect(surface.startupCommand).toBe("echo hello");
    expect(surface.pendingRestoreCommand).toBeUndefined();
  });

  it("sets startupCommand (auto-run) when autoRunRestoreCommands is undefined on parent workspace", async () => {
    const ws = makeWorkspace("g1"); // autoRunRestoreCommands not set → defaults to opt-out (true)
    addWorkspace(ws);

    await createWorkspaceFromDef(
      {
        name: "Test",
        cwd: "/tmp",
        metadata: { rootWorkspaceId: "g1" },
        layout: {
          pane: {
            surfaces: [{ command: "echo hello" }],
          },
        },
      },
      { restoring: true },
    );

    const allChildWs = get(workspaces);
    const createdWs = allChildWs[allChildWs.length - 1]!;
    const pane =
      createdWs.paneLayout.type === "pane" ? createdWs.paneLayout.pane : null;
    expect(pane).not.toBeNull();
    const surface = pane!.surfaces[0] as {
      startupCommand?: string;
      pendingRestoreCommand?: true;
    };
    expect(surface.startupCommand).toBe("echo hello");
    expect(surface.pendingRestoreCommand).toBeUndefined();
  });

  it("sets pendingRestoreCommand when autoRunRestoreCommands is explicitly false on parent workspace", async () => {
    const ws = makeWorkspace("g1", { autoRunRestoreCommands: false });
    addWorkspace(ws);

    await createWorkspaceFromDef(
      {
        name: "Test",
        cwd: "/tmp",
        metadata: { rootWorkspaceId: "g1" },
        layout: {
          pane: {
            surfaces: [{ command: "echo hello" }],
          },
        },
      },
      { restoring: true },
    );

    const allChildWs = get(workspaces);
    const createdWs = allChildWs[allChildWs.length - 1]!;
    const pane =
      createdWs.paneLayout.type === "pane" ? createdWs.paneLayout.pane : null;
    expect(pane).not.toBeNull();
    const surface = pane!.surfaces[0] as {
      startupCommand?: string;
      pendingRestoreCommand?: true;
    };
    expect(surface.pendingRestoreCommand).toBe(true);
    expect(surface.startupCommand).toBeUndefined();
  });
});
