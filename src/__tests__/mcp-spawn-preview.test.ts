/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MCP preview-surface tools: spawn_preview, create_preview_file,
 * list_open_previews, list_markdown_components.
 *
 * The preview-surface-registry is normally populated by PreviewSurface.svelte's
 * mount lifecycle. Unit tests don't mount Svelte components, so dedupe-related
 * tests register entries directly to simulate an already-open preview.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  emit: vi.fn().mockResolvedValue(undefined),
}));

import {
  dispatch,
  _testContext,
  _resetMcpServerForTest,
} from "../lib/services/mcp-server";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/nested-workspace";
import type { NestedWorkspace, Pane } from "../lib/types";
import { isPreviewSurface, getAllSurfaces } from "../lib/types";
import {
  registerPreviewSurface,
  resetPreviewSurfaceRegistry,
} from "../lib/services/preview-surface-registry";
import {
  registerMarkdownComponent,
  resetMarkdownComponents,
} from "../lib/services/markdown-component-registry";

function rpc(method: string, params?: unknown, id: number = 1) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

function makeNestedWorkspace(
  id: string,
  name = id,
): { ws: NestedWorkspace; pane: Pane } {
  const pane: Pane = { id: `${id}-pane`, surfaces: [], activeSurfaceId: null };
  const ws: NestedWorkspace = {
    id,
    name,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
  return { ws, pane };
}

describe("MCP — spawn_preview", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    _resetMcpServerForTest();
    resetPreviewSurfaceRegistry();
    resetMarkdownComponents();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("opens a preview surface in the binding's host pane", async () => {
    const { ws, pane } = makeNestedWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ paneId: pane.id, workspaceId: "ws-1" });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "spawn_preview",
        arguments: { path: "/abs/notes.md" },
      }),
      ctx,
    );

    const result = (resp as any).result.structuredContent;
    expect(result.surface_id).toBeTruthy();
    expect(result.pane_id).toBe(pane.id);
    expect(result.workspace_id).toBe("ws-1");
    expect(result.reused).toBe(false);

    const surfaces = getAllSurfaces(get(nestedWorkspaces)[0]!);
    expect(surfaces).toHaveLength(1);
    const placed = surfaces[0]!;
    expect(isPreviewSurface(placed)).toBe(true);
    if (isPreviewSurface(placed)) {
      expect(placed.path).toBe("/abs/notes.md");
    }
  });

  it("focuses an existing preview when the same path is already open", async () => {
    const { ws, pane } = makeNestedWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    // Simulate an already-mounted preview (PreviewSurface.svelte normally
    // registers itself on mount; tests bypass that).
    registerPreviewSurface({
      surfaceId: "existing-surface",
      path: "/abs/design.md",
      paneId: pane.id,
      workspaceId: "ws-1",
    });

    const ctx = _testContext({ paneId: pane.id, workspaceId: "ws-1" });
    const resp = await dispatch(
      rpc("tools/call", {
        name: "spawn_preview",
        arguments: { path: "/abs/design.md" },
      }),
      ctx,
    );

    const result = (resp as any).result.structuredContent;
    expect(result.surface_id).toBe("existing-surface");
    expect(result.reused).toBe(true);
    // No new surface placed in the workspace.
    expect(getAllSurfaces(get(nestedWorkspaces)[0]!)).toHaveLength(0);
  });

  it("explicit pane_id wins over the binding pane", async () => {
    const { ws: wsA, pane: paneA } = makeNestedWorkspace("ws-A");
    const { ws: wsB, pane: paneB } = makeNestedWorkspace("ws-B");
    nestedWorkspaces.set([wsA, wsB]);
    const ctx = _testContext({ paneId: paneA.id, workspaceId: "ws-A" });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "spawn_preview",
        arguments: { path: "/abs/x.md", pane_id: paneB.id },
      }),
      ctx,
    );

    const result = (resp as any).result.structuredContent;
    expect(result.pane_id).toBe(paneB.id);
    expect(result.workspace_id).toBe("ws-B");
    // The surface landed in B, not A.
    expect(getAllSurfaces(wsA)).toHaveLength(0);
    expect(getAllSurfaces(wsB)).toHaveLength(1);
  });

  it("errors when unbound and no workspace_id/pane_id is passed", async () => {
    const { ws } = makeNestedWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);
    const ctx = _testContext(null);

    const resp = await dispatch(
      rpc("tools/call", {
        name: "spawn_preview",
        arguments: { path: "/abs/x.md" },
      }),
      ctx,
    );

    expect((resp as any).error?.code).toBe(-32000);
    expect((resp as any).error?.message).toMatch(/no pane\/workspace context/);
  });
});

describe("MCP — create_preview_file", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    _resetMcpServerForTest();
    resetPreviewSurfaceRegistry();
    resetMarkdownComponents();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("invokes write_file then opens the preview", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { ws, pane } = makeNestedWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ paneId: pane.id, workspaceId: "ws-1" });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "create_preview_file",
        arguments: { path: "/abs/report.md", content: "# Report\n" },
      }),
      ctx,
    );

    expect(invokeMock).toHaveBeenCalledWith("write_file", {
      path: "/abs/report.md",
      content: "# Report\n",
    });
    const result = (resp as any).result.structuredContent;
    expect(result.surface_id).toBeTruthy();
    expect(result.pane_id).toBe(pane.id);
    expect(result.workspace_id).toBe("ws-1");

    const surfaces = getAllSurfaces(get(nestedWorkspaces)[0]!);
    expect(surfaces).toHaveLength(1);
    const placed = surfaces[0]!;
    if (isPreviewSurface(placed)) {
      expect(placed.path).toBe("/abs/report.md");
    } else {
      throw new Error("expected a preview surface");
    }
  });

  it("propagates write_file errors without opening a surface", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Write denied: blocked path"));
    const { ws, pane } = makeNestedWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ paneId: pane.id, workspaceId: "ws-1" });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "create_preview_file",
        arguments: { path: "/etc/passwd", content: "nope" },
      }),
      ctx,
    );

    expect((resp as any).error?.code).toBe(-32000);
    expect((resp as any).error?.message).toMatch(/Write denied/);
    expect(getAllSurfaces(get(nestedWorkspaces)[0]!)).toHaveLength(0);
  });
});

describe("MCP — list_open_previews", () => {
  beforeEach(() => {
    _resetMcpServerForTest();
    resetPreviewSurfaceRegistry();
  });

  it("returns the registry contents", async () => {
    registerPreviewSurface({
      surfaceId: "s1",
      path: "/abs/a.md",
      paneId: "p1",
      workspaceId: "ws-1",
    });
    registerPreviewSurface({
      surfaceId: "s2",
      path: "/abs/b.md",
      paneId: "p2",
      workspaceId: "ws-2",
    });

    const resp = await dispatch(
      rpc("tools/call", { name: "list_open_previews", arguments: {} }),
    );
    const result = (resp as any).result.structuredContent;
    expect(result.previews).toEqual([
      {
        surface_id: "s1",
        path: "/abs/a.md",
        pane_id: "p1",
        workspace_id: "ws-1",
      },
      {
        surface_id: "s2",
        path: "/abs/b.md",
        pane_id: "p2",
        workspace_id: "ws-2",
      },
    ]);
  });

  it("returns an empty list when no previews are open", async () => {
    const resp = await dispatch(
      rpc("tools/call", { name: "list_open_previews", arguments: {} }),
    );
    expect((resp as any).result.structuredContent).toEqual({ previews: [] });
  });
});

describe("MCP — close_preview", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    _resetMcpServerForTest();
    resetPreviewSurfaceRegistry();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("closes a preview surface registered with the registry", async () => {
    const { ws, pane } = makeNestedWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ paneId: pane.id, workspaceId: "ws-1" });

    // Spawn a preview the normal way so it lands in the pane and registers.
    const spawnResp = await dispatch(
      rpc("tools/call", {
        name: "spawn_preview",
        arguments: { path: "/abs/closeme.md" },
      }),
      ctx,
    );
    const spawnResult = (spawnResp as any).result.structuredContent;
    const surfaceId = spawnResult.surface_id as string;

    // The spawn handler does not auto-register (only PreviewSurface.svelte's
    // mount lifecycle does). Mirror the registration so close_preview can
    // resolve the entry under unit-test conditions.
    registerPreviewSurface({
      surfaceId,
      path: "/abs/closeme.md",
      paneId: pane.id,
      workspaceId: "ws-1",
    });

    const closeResp = await dispatch(
      rpc("tools/call", {
        name: "close_preview",
        arguments: { surface_id: surfaceId },
      }),
    );
    const closeResult = (closeResp as any).result.structuredContent;
    expect(closeResult).toEqual({ closed: true });
    // The preview was the only surface in the only pane — closing it
    // closed the whole workspace, so the surface id is no longer
    // anywhere in the nestedWorkspaces list.
    const remaining = get(nestedWorkspaces).flatMap((ws) =>
      getAllSurfaces(ws).map((s) => s.id),
    );
    expect(remaining).not.toContain(surfaceId);
  });

  it("returns { closed: false } for an unknown surface id", async () => {
    const resp = await dispatch(
      rpc("tools/call", {
        name: "close_preview",
        arguments: { surface_id: "does-not-exist" },
      }),
    );
    const result = (resp as any).result.structuredContent;
    expect(result).toEqual({ closed: false });
  });
});

describe("MCP — list_markdown_components", () => {
  beforeEach(() => {
    _resetMcpServerForTest();
    resetMarkdownComponents();
  });

  it("returns each registered component with name + source + configSchema", async () => {
    registerMarkdownComponent({
      name: "kanban",
      component: {},
      source: "agentic-orchestrator",
      configSchema: { fields: { columns: { type: "number" } } },
    });
    registerMarkdownComponent({
      name: "counter",
      component: {},
      source: "core",
    });

    const resp = await dispatch(
      rpc("tools/call", { name: "list_markdown_components", arguments: {} }),
    );
    const result = (resp as any).result.structuredContent;
    const sorted = (
      result.components as Array<{
        name: string;
        source: string;
        configSchema?: Record<string, unknown>;
      }>
    )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted).toEqual([
      { name: "counter", source: "core", configSchema: undefined },
      {
        name: "kanban",
        source: "agentic-orchestrator",
        configSchema: { fields: { columns: { type: "number" } } },
      },
    ]);
  });

  it("returns an empty list when nothing is registered", async () => {
    const resp = await dispatch(
      rpc("tools/call", { name: "list_markdown_components", arguments: {} }),
    );
    expect((resp as any).result.structuredContent).toEqual({ components: [] });
  });
});
