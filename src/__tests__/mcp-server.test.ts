/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MCP server unit tests. Exercises the JSON-RPC dispatcher and the handlers
 * that don't require a live PTY (tools/list, sidebar, poll_events, fs tools,
 * workspace introspection).
 *
 * `any` casts below are for narrowing loosely-typed JSON-RPC response bodies
 * in test assertions — a common pattern for test-only code.
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

import { dispatch, _getToolsForTest } from "../lib/services/mcp-server";
import {
  mcpSidebarSections,
  _resetMcpSidebarForTest,
} from "../lib/stores/mcp-sidebar";
import { _resetEventBufferForTest } from "../lib/services/mcp-event-buffer";
import {
  registerSurfaceType,
  resetSurfaceTypes,
} from "../lib/services/surface-type-registry";
import {
  registerCommand,
  resetCommands,
} from "../lib/services/command-registry";
import {
  registerSidebarTab,
  resetSidebarTabs,
  activeSidebarTabStore,
} from "../lib/services/sidebar-tab-registry";
import {
  registerWorkspaceAction,
  resetWorkspaceActions,
} from "../lib/services/workspace-action-registry";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { getAllSurfaces } from "../lib/types";

function rpc(method: string, params?: unknown, id: number = 1) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

describe("MCP server JSON-RPC", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    _resetMcpSidebarForTest();
    _resetEventBufferForTest();
  });

  it("responds to initialize with server info and protocol version", async () => {
    const resp = await dispatch(rpc("initialize"));
    expect(resp).toBeTruthy();
    expect((resp as any).result.protocolVersion).toBe("2025-11-25");
    expect((resp as any).result.serverInfo.name).toBe("gnar-term");
    expect((resp as any).result.capabilities.tools).toBeDefined();
  });

  it("lists all 26 tools with correct names", async () => {
    const resp = await dispatch(rpc("tools/list"));
    const tools = (resp as any).result.tools as Array<{ name: string }>;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "activate_sidebar_tab",
        "dispatch_tasks",
        "file_exists",
        "get_active_pane",
        "get_active_workspace",
        "get_session_info",
        "invoke_command",
        "invoke_workspace_action",
        "kill_session",
        "list_commands",
        "list_dir",
        "list_panes",
        "list_sessions",
        "list_sidebar_tabs",
        "list_surface_types",
        "list_workspace_actions",
        "list_workspaces",
        "open_surface",
        "poll_events",
        "read_file",
        "read_output",
        "remove_sidebar_section",
        "render_sidebar",
        "send_keys",
        "send_prompt",
        "spawn_agent",
      ].sort(),
    );
    expect(names).toHaveLength(26);
    // Every tool must ship a JSON Schema shaped object.
    for (const t of tools) {
      expect(t).toHaveProperty("inputSchema");
    }
  });

  it("returns an error for unknown methods", async () => {
    const resp = await dispatch(rpc("nope"));
    expect((resp as any).error.code).toBe(-32601);
  });

  it("swallows notifications (no id) silently", async () => {
    const resp = await dispatch({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    } as any);
    expect(resp).toBeNull();
  });

  it("render_sidebar upserts a section into the store", async () => {
    const resp = await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: {
          side: "secondary",
          section_id: "cwd-file-navigator",
          title: "Files",
          items: [
            { id: "README.md", label: "README.md" },
            {
              id: "src",
              label: "src",
              children: [{ id: "src/App.svelte", label: "App.svelte" }],
            },
          ],
        },
      }),
    );
    expect((resp as any).result.structuredContent).toEqual({ ok: true });
    const map = get(mcpSidebarSections);
    expect(map.size).toBe(1);
    const section = map.get("secondary:cwd-file-navigator");
    expect(section?.title).toBe("Files");
    expect(section?.items).toHaveLength(2);
  });

  it("remove_sidebar_section is a no-op for unknown ids", async () => {
    const resp = await dispatch(
      rpc("tools/call", {
        name: "remove_sidebar_section",
        arguments: { side: "primary", section_id: "nope" },
      }),
    );
    expect((resp as any).result.structuredContent).toEqual({ ok: true });
  });

  it("poll_events returns the cursor and truncated flag", async () => {
    await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: { side: "primary", section_id: "x", title: "X", items: [] },
      }),
    );
    const resp = await dispatch(
      rpc("tools/call", { name: "poll_events", arguments: {} }),
    );
    const result = (resp as any).result.structuredContent;
    expect(result).toHaveProperty("cursor");
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("list_dir invokes mcp_list_dir with includeHidden alias", async () => {
    invokeMock.mockResolvedValueOnce([
      { name: "a.txt", path: "/tmp/a.txt", is_dir: false, size: 10 },
    ]);
    const resp = await dispatch(
      rpc("tools/call", {
        name: "list_dir",
        arguments: { path: "/tmp", include_hidden: false },
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("mcp_list_dir", {
      path: "/tmp",
      includeHidden: false,
    });
    const entries = (resp as any).result.structuredContent.entries;
    expect(entries[0].name).toBe("a.txt");
  });

  it("read_file truncates according to max_bytes", async () => {
    invokeMock.mockResolvedValueOnce("the quick brown fox");
    const resp = await dispatch(
      rpc("tools/call", {
        name: "read_file",
        arguments: { path: "/tmp/x", max_bytes: 9 },
      }),
    );
    const r = (resp as any).result.structuredContent;
    expect(r.content).toBe("the quick");
    expect(r.truncated).toBe(true);
  });

  it("file_exists maps the [exists, is_dir] tuple", async () => {
    invokeMock.mockResolvedValueOnce([true, true]);
    const r = await dispatch(
      rpc("tools/call", { name: "file_exists", arguments: { path: "/tmp" } }),
    );
    expect((r as any).result.structuredContent).toEqual({
      exists: true,
      is_dir: true,
    });

    invokeMock.mockResolvedValueOnce([false, false]);
    const r2 = await dispatch(
      rpc("tools/call", { name: "file_exists", arguments: { path: "/nope" } }),
    );
    expect((r2 as any).result.structuredContent).toEqual({ exists: false });
  });

  it("list_workspaces returns an array (possibly empty)", async () => {
    const r = await dispatch(
      rpc("tools/call", { name: "list_workspaces", arguments: {} }),
    );
    const result = (r as any).result.structuredContent;
    expect(Array.isArray(result)).toBe(true);
  });

  it("list_surface_types returns an array of { id, label, source }", async () => {
    const r = await dispatch(
      rpc("tools/call", { name: "list_surface_types", arguments: {} }),
    );
    const result = (r as any).result.structuredContent;
    expect(result).toHaveProperty("types");
    expect(Array.isArray(result.types)).toBe(true);
  });

  it("open_surface rejects an unregistered surface type", async () => {
    const resp = await dispatch(
      rpc("tools/call", {
        name: "open_surface",
        arguments: {
          surface_type_id: "nope:nope",
          title: "x",
        },
      }),
    );
    expect((resp as any).error.code).toBe(-32000);
    expect((resp as any).error.message).toMatch(/Unknown surface type/);
  });

  it("open_surface places a registered surface into the active pane", async () => {
    resetSurfaceTypes();
    registerSurfaceType({
      id: "test:panel",
      label: "Panel",
      component: {} as unknown,
      source: "test",
    });
    workspaces.set([
      {
        id: "ws-1",
        name: "WS",
        activePaneId: "pane-1",
        splitRoot: {
          type: "pane",
          pane: { id: "pane-1", surfaces: [], activeSurfaceId: null },
        },
      },
    ]);
    activeWorkspaceIdx.set(0);

    const resp = await dispatch(
      rpc("tools/call", {
        name: "open_surface",
        arguments: {
          surface_type_id: "test:panel",
          title: "Test Panel",
          props: { hello: "world" },
          placement: "current-pane",
        },
      }),
    );
    const r = (resp as any).result.structuredContent;
    expect(r.surface_id).toBeTruthy();
    expect(r.pane_id).toBe("pane-1");

    const ws = get(workspaces)[0]!;
    const placed = getAllSurfaces(ws);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.kind).toBe("extension");
    expect(placed[0]!.title).toBe("Test Panel");
    expect((placed[0] as { props: Record<string, unknown> }).props).toEqual({
      hello: "world",
    });
  });

  it("open_surface split-down creates a vertical split", async () => {
    resetSurfaceTypes();
    registerSurfaceType({
      id: "test:panel",
      label: "Panel",
      component: {},
      source: "test",
    });
    workspaces.set([
      {
        id: "ws-d",
        name: "WS",
        activePaneId: "pane-d",
        splitRoot: {
          type: "pane",
          pane: { id: "pane-d", surfaces: [], activeSurfaceId: null },
        },
      },
    ]);
    activeWorkspaceIdx.set(0);

    await dispatch(
      rpc("tools/call", {
        name: "open_surface",
        arguments: {
          surface_type_id: "test:panel",
          title: "P",
          placement: "split-down",
        },
      }),
    );
    const ws = get(workspaces)[0]!;
    expect(ws.splitRoot.type).toBe("split");
    if (ws.splitRoot.type === "split") {
      expect(ws.splitRoot.direction).toBe("vertical");
    }
  });

  it("open_surface split-right creates a new pane and places the surface there", async () => {
    resetSurfaceTypes();
    registerSurfaceType({
      id: "test:panel",
      label: "Panel",
      component: {} as unknown,
      source: "test",
    });
    workspaces.set([
      {
        id: "ws-2",
        name: "WS2",
        activePaneId: "pane-a",
        splitRoot: {
          type: "pane",
          pane: { id: "pane-a", surfaces: [], activeSurfaceId: null },
        },
      },
    ]);
    activeWorkspaceIdx.set(0);

    const resp = await dispatch(
      rpc("tools/call", {
        name: "open_surface",
        arguments: {
          surface_type_id: "test:panel",
          title: "Panel B",
          placement: "split-right",
        },
      }),
    );
    const r = (resp as any).result.structuredContent;
    expect(r.pane_id).not.toBe("pane-a"); // a new pane was created
    const ws = get(workspaces)[0]!;
    // Splitting should have promoted the root to a split node
    expect(ws.splitRoot.type).toBe("split");
  });

  it("get_active_pane returns the active pane's info", async () => {
    workspaces.set([
      {
        id: "ws-ap",
        name: "WS",
        activePaneId: "pane-ap",
        splitRoot: {
          type: "pane",
          pane: { id: "pane-ap", surfaces: [], activeSurfaceId: null },
        },
      },
    ]);
    activeWorkspaceIdx.set(0);
    const r = await dispatch(
      rpc("tools/call", { name: "get_active_pane", arguments: {} }),
    );
    const info = (r as any).result.structuredContent;
    expect(info.id).toBe("pane-ap");
    expect(info.workspaceId).toBe("ws-ap");
  });

  it("get_active_workspace returns info when a workspace is active", async () => {
    workspaces.set([
      {
        id: "ws-aw",
        name: "Active",
        activePaneId: null,
        splitRoot: {
          type: "pane",
          pane: { id: "p", surfaces: [], activeSurfaceId: null },
        },
      },
    ]);
    activeWorkspaceIdx.set(0);
    const r = await dispatch(
      rpc("tools/call", { name: "get_active_workspace", arguments: {} }),
    );
    const info = (r as any).result.structuredContent;
    expect(info).not.toBeNull();
    expect(info.id).toBe("ws-aw");
  });

  it("list_surface_types includes every registered type", async () => {
    resetSurfaceTypes();
    registerSurfaceType({
      id: "a:b",
      label: "AB",
      component: {},
      source: "a",
    });
    registerSurfaceType({
      id: "c:d",
      label: "CD",
      component: {},
      source: "c",
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_surface_types", arguments: {} }),
    );
    const types = (r as any).result.structuredContent.types as Array<{
      id: string;
    }>;
    const ids = types.map((t) => t.id).sort();
    expect(ids).toEqual(["a:b", "c:d"]);
  });

  it("returns a JSON-RPC error when a tool handler throws", async () => {
    const resp = await dispatch(
      rpc("tools/call", {
        name: "kill_session",
        arguments: { session_id: "nonexistent" },
      }),
    );
    expect((resp as any).error.code).toBe(-32000);
    expect((resp as any).error.message).toMatch(/not found/);
  });

  it("returns -32601 for unknown tool names", async () => {
    const resp = await dispatch(
      rpc("tools/call", { name: "nope", arguments: {} }),
    );
    expect((resp as any).error.code).toBe(-32601);
  });
});

describe("MCP mirror tools — commands", () => {
  beforeEach(() => {
    resetCommands();
  });

  it("list_commands returns every registered command", async () => {
    registerCommand({
      id: "ext.do-thing",
      title: "Do Thing",
      shortcut: "⌘⇧T",
      action: () => {},
      source: "my-ext",
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_commands", arguments: {} }),
    );
    const result = (r as any).result.structuredContent;
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toEqual({
      id: "ext.do-thing",
      title: "Do Thing",
      shortcut: "⌘⇧T",
      source: "my-ext",
    });
  });

  it("invoke_command runs the action", async () => {
    let called = 0;
    registerCommand({
      id: "ext.run",
      title: "Run",
      action: () => {
        called += 1;
      },
      source: "my-ext",
    });
    const r = await dispatch(
      rpc("tools/call", {
        name: "invoke_command",
        arguments: { command_id: "ext.run" },
      }),
    );
    expect((r as any).result.structuredContent).toEqual({ ok: true });
    expect(called).toBe(1);
  });

  it("invoke_command rejects an unknown id", async () => {
    const resp = await dispatch(
      rpc("tools/call", {
        name: "invoke_command",
        arguments: { command_id: "does-not-exist" },
      }),
    );
    expect((resp as any).error.code).toBe(-32000);
    expect((resp as any).error.message).toMatch(/Unknown command/);
  });
});

describe("MCP mirror tools — sidebar tabs", () => {
  beforeEach(() => {
    resetSidebarTabs();
  });

  it("list_sidebar_tabs returns registered tabs", async () => {
    registerSidebarTab({
      id: "files",
      label: "Files",
      component: {},
      source: "file-browser",
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_sidebar_tabs", arguments: {} }),
    );
    const result = (r as any).result.structuredContent;
    expect(result.tabs).toEqual([
      { id: "files", label: "Files", source: "file-browser" },
    ]);
  });

  it("activate_sidebar_tab updates the active tab store", async () => {
    registerSidebarTab({
      id: "changes",
      label: "Changes",
      component: {},
      source: "diff-viewer",
    });
    const r = await dispatch(
      rpc("tools/call", {
        name: "activate_sidebar_tab",
        arguments: { tab_id: "changes" },
      }),
    );
    expect((r as any).result.structuredContent).toEqual({ ok: true });
    expect(get(activeSidebarTabStore)).toBe("changes");
  });

  it("activate_sidebar_tab rejects unknown tab ids", async () => {
    const resp = await dispatch(
      rpc("tools/call", {
        name: "activate_sidebar_tab",
        arguments: { tab_id: "nope" },
      }),
    );
    expect((resp as any).error.code).toBe(-32000);
  });
});

describe("MCP mirror tools — workspace actions", () => {
  beforeEach(() => {
    resetWorkspaceActions();
  });

  it("list_workspace_actions returns registered actions", async () => {
    registerWorkspaceAction({
      id: "create-worktree",
      label: "New Worktree",
      icon: "git-branch",
      zone: "sidebar",
      handler: () => {},
      source: "managed-workspaces",
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_workspace_actions", arguments: {} }),
    );
    const result = (r as any).result.structuredContent;
    expect(result.actions).toEqual([
      {
        id: "create-worktree",
        label: "New Worktree",
        icon: "git-branch",
        zone: "sidebar",
        source: "managed-workspaces",
      },
    ]);
  });

  it("invoke_workspace_action forwards context to the handler", async () => {
    let received: Record<string, unknown> | null = null;
    registerWorkspaceAction({
      id: "ext.thing",
      label: "Thing",
      icon: "star",
      handler: (ctx) => {
        received = ctx as Record<string, unknown>;
      },
      source: "ext",
    });
    await dispatch(
      rpc("tools/call", {
        name: "invoke_workspace_action",
        arguments: { action_id: "ext.thing", context: { branch: "main" } },
      }),
    );
    expect(received).toEqual({ branch: "main" });
  });

  it("invoke_workspace_action rejects unknown action ids", async () => {
    const resp = await dispatch(
      rpc("tools/call", {
        name: "invoke_workspace_action",
        arguments: { action_id: "nope" },
      }),
    );
    expect((resp as any).error.code).toBe(-32000);
  });
});

describe("tool metadata", () => {
  it("every tool has a non-empty description", () => {
    const tools = _getToolsForTest();
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("tool count matches spec (26)", () => {
    expect(_getToolsForTest()).toHaveLength(26);
  });
});
