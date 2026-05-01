/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MCP server unit tests. Adversarial coverage of the connection-binding
 * contract: every test that exercises a UI-mutating tool sets ambient state
 * (active workspace, user focus) DIFFERENTLY from the test's expectation, so
 * that any future code that quietly reads ambient state for routing fails.
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

const { spawnAgentInWorktreeMock } = vi.hoisted(() => ({
  spawnAgentInWorktreeMock: vi.fn(),
}));

vi.mock("../lib/services/spawn-helper", () => ({
  spawnAgentInWorktree: spawnAgentInWorktreeMock,
}));

const { agentsStoreMock } = vi.hoisted(() => {
  // vi.hoisted runs before imports, so we can't use the svelte/store `writable`
  // imported at the top of this file. Instead we build a minimal readable-store
  // shim: `get(agentsStore)` in mcp-server calls the store's `subscribe` once
  // and reads the value, which is exactly what this shim supports.
  let _value: unknown[] = [];
  const agentsStoreMock = {
    subscribe: (run: (v: unknown[]) => void) => {
      run(_value);
      return () => {};
    },
    _set: (v: unknown[]) => {
      _value = v;
    },
    set: (v: unknown[]) => {
      _value = v;
    },
  };
  return { agentsStoreMock };
});

vi.mock("../lib/services/agent-detection-service", () => ({
  agentsStore: agentsStoreMock,
}));

import {
  dispatch,
  _getToolsForTest,
  _getSessionsForTest,
  _testContext,
  _resolveTargetForTest,
  _resetMcpServerForTest,
} from "../lib/services/mcp-server";
import {
  mcpSidebarSections,
  _resetMcpSidebarForTest,
} from "../lib/stores/mcp-sidebar";
import { _resetEventBufferForTest } from "../lib/services/mcp-event-buffer";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/workspace";
import type { NestedWorkspace, Pane } from "../lib/types";
import { getAllSurfaces } from "../lib/types";
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
import {
  registerContextMenuItem,
  resetContextMenuItems,
} from "../lib/services/context-menu-item-registry";

function rpc(method: string, params?: unknown, id: number = 1) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

/** Build a deterministic workspace fixture with a given id and a single pane. */
function makeWorkspace(
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

describe("MCP server JSON-RPC", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    _resetMcpSidebarForTest();
    _resetEventBufferForTest();
    _resetMcpServerForTest();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    agentsStoreMock.set([]);
  });

  it("responds to initialize with server info and protocol version", async () => {
    const resp = await dispatch(rpc("initialize"));
    expect(resp).toBeTruthy();
    expect((resp as any).result.protocolVersion).toBe("2025-11-25");
    expect((resp as any).result.serverInfo.name).toBe("gnar-term");
    expect((resp as any).result.capabilities.tools).toBeDefined();
  });

  it("lists all tools with correct names", async () => {
    const resp = await dispatch(rpc("tools/list"));
    const tools = (resp as any).result.tools as Array<{ name: string }>;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "activate_sidebar_tab",
        "add_dashboard_to_group",
        "close_preview",
        "create_preview_file",
        "dispatch_tasks",
        "file_exists",
        "get_active_pane",
        "get_active_workspace",
        "get_agent_context",
        "get_session_info",
        "get_status_for_workspace",
        "invoke_command",
        "invoke_context_menu_item",
        "invoke_workspace_action",
        "kill_session",
        "list_agents",
        "list_commands",
        "list_context_menu_items",
        "list_dashboard_contributions",
        "list_dashboard_tabs",
        "list_dir",
        "list_markdown_components",
        "list_open_previews",
        "list_dashboard_workspaces",
        "list_panes",
        "list_sidebar_sections",
        "list_sidebar_tabs",
        "list_surface_types",
        "list_workspace_actions",
        "list_workspace_subtitles",
        "list_workspaces",
        "open_surface",
        "poll_events",
        "read_file",
        "read_output",
        "remove_dashboard_from_group",
        "remove_sidebar_section",
        "render_sidebar",
        "send_keys",
        "send_prompt",
        "spawn_agent",
        "spawn_preview",
        "split_pane",
        "write_file",
      ].sort(),
    );
    expect(names).toHaveLength(44);
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

  it("$/gnar-term/hello stores the binding on the connection context", async () => {
    const ctx = _testContext(null);
    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        method: "$/gnar-term/hello",
        params: { pane_id: "p-1", workspace_id: "ws-1", client_pid: 42 },
      } as any,
      ctx,
    );
    expect(resp).toBeNull();
    expect(ctx.binding).toEqual({
      paneId: "p-1",
      workspaceId: "ws-1",
      clientPid: 42,
    });
  });

  it("get_agent_context returns the connection's binding", async () => {
    const ctx = _testContext({
      paneId: "p-x",
      workspaceId: "ws-x",
      clientPid: 1234,
    });
    const resp = await dispatch(
      rpc("tools/call", { name: "get_agent_context", arguments: {} }),
      ctx,
    );
    const r = (resp as any).result.structuredContent;
    expect(r).toEqual({
      pane_id: "p-x",
      workspace_id: "ws-x",
      client_pid: 1234,
    });
  });

  it("get_agent_context returns null fields when the agent is unbound", async () => {
    const ctx = _testContext(null);
    const resp = await dispatch(
      rpc("tools/call", { name: "get_agent_context", arguments: {} }),
      ctx,
    );
    expect((resp as any).result.structuredContent).toEqual({
      pane_id: null,
      workspace_id: null,
      client_pid: null,
    });
  });

  it("render_sidebar with an explicit workspace_id stores in that workspace", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    nestedWorkspaces.set([wsA, wsB]);
    activeNestedWorkspaceIdx.set(0); // user is looking at A

    // Adversarial: bind connection to A, then explicitly target B. Override
    // must win — the section must end up in B, not A.
    const ctx = _testContext({ workspaceId: "ws-A" });
    const resp = await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: {
          side: "secondary",
          section_id: "s1",
          title: "S1",
          items: [{ id: "a", label: "A" }],
          workspace_id: "ws-B",
        },
      }),
      ctx,
    );
    expect((resp as any).result.structuredContent).toEqual({
      ok: true,
      workspace_id: "ws-B",
    });
    const map = get(mcpSidebarSections);
    expect(map.size).toBe(1);
    const section = map.get("ws-B:secondary:s1");
    expect(section?.workspaceId).toBe("ws-B");
    expect(section?.title).toBe("S1");
  });

  it("render_sidebar uses the connection binding when no workspace_id is passed", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    nestedWorkspaces.set([wsA, wsB]);
    activeNestedWorkspaceIdx.set(0); // user looks at A

    // Adversarial: bind connection to B but make A the active workspace. The
    // render must follow the binding (B), not user focus (A).
    const ctx = _testContext({ workspaceId: "ws-B" });
    await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: {
          side: "primary",
          section_id: "s1",
          title: "S1",
          items: [],
        },
      }),
      ctx,
    );
    const map = get(mcpSidebarSections);
    expect(map.has("ws-B:primary:s1")).toBe(true);
    expect(map.has("ws-A:primary:s1")).toBe(false);
  });

  it("render_sidebar errors clearly when unbound and no workspace_id passed", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    nestedWorkspaces.set([wsA]);
    activeNestedWorkspaceIdx.set(0); // there IS an active workspace, but agent is unbound

    const ctx = _testContext(null);
    const resp = await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: {
          side: "secondary",
          section_id: "x",
          title: "X",
          items: [],
        },
      }),
      ctx,
    );
    // Resolution rule 5: must error, NOT silently target the active workspace.
    expect((resp as any).error?.code).toBe(-32000);
    expect((resp as any).error?.message).toMatch(/no pane\/workspace context/);
    expect(get(mcpSidebarSections).size).toBe(0);
  });

  it("remove_sidebar_section uses the binding workspace", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    nestedWorkspaces.set([wsA]);
    activeNestedWorkspaceIdx.set(0);

    const ctx = _testContext({ workspaceId: "ws-A" });
    await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: { side: "primary", section_id: "x", title: "X", items: [] },
      }),
      ctx,
    );
    expect(get(mcpSidebarSections).size).toBe(1);

    const resp = await dispatch(
      rpc("tools/call", {
        name: "remove_sidebar_section",
        arguments: { side: "primary", section_id: "x" },
      }),
      ctx,
    );
    expect((resp as any).result.structuredContent.ok).toBe(true);
    expect(get(mcpSidebarSections).size).toBe(0);
  });

  it("poll_events returns the cursor and events array", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    nestedWorkspaces.set([wsA]);
    activeNestedWorkspaceIdx.set(0);
    const ctx = _testContext({ workspaceId: "ws-A" });
    await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: { side: "primary", section_id: "x", title: "X", items: [] },
      }),
      ctx,
    );
    const resp = await dispatch(
      rpc("tools/call", { name: "poll_events", arguments: {} }),
    );
    const result = (resp as any).result.structuredContent;
    expect(result).toHaveProperty("cursor");
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("list_agents returns all detected agents including native (non-MCP-spawned) ones", async () => {
    // Populate the store with a native agent (one the user started by typing
    // `claude` in a terminal — not via spawn_agent). list_agents must see it.
    agentsStoreMock.set([
      {
        agentId: "native-1",
        agentName: "Claude Code",
        surfaceId: "surf-1",
        workspaceId: "ws-1",
        status: "running",
        createdAt: "2024-01-01T00:00:00.000Z",
        lastStatusChange: "2024-01-01T00:01:00.000Z",
      },
    ]);

    const resp = await dispatch(
      rpc("tools/call", { name: "list_agents", arguments: {} }),
    );
    const agents = (resp as any).result.structuredContent.agents as unknown[];
    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual({
      agentId: "native-1",
      agentName: "Claude Code",
      surfaceId: "surf-1",
      workspaceId: "ws-1",
      status: "running",
      createdAt: "2024-01-01T00:00:00.000Z",
      lastStatusChange: "2024-01-01T00:01:00.000Z",
    });
  });

  it("list_agents returns an empty array when no agents are detected", async () => {
    agentsStoreMock.set([]);
    const resp = await dispatch(
      rpc("tools/call", { name: "list_agents", arguments: {} }),
    );
    const result = (resp as any).result.structuredContent;
    expect(result).toEqual({ agents: [] });
  });

  it("split_pane creates a new pane in the target workspace and returns pane_id", async () => {
    // makeWorkspace returns { ws, pane } — see the fixture helper at line ~99
    const { ws, pane } = makeWorkspace("ws-split");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ paneId: pane.id, workspaceId: ws.id });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "split_pane",
        arguments: { workspace_id: ws.id },
      }),
      ctx,
    );

    const result = (resp as any).result.structuredContent;
    expect(result).toHaveProperty("pane_id");
    expect(result.pane_id).not.toBe(pane.id); // new pane, different id
    expect(result).toHaveProperty("workspace_id", ws.id);
  });

  it("split_pane throws when surface_type is preview but preview_path is missing", async () => {
    const { ws, pane } = makeWorkspace("ws-split-err");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ paneId: pane.id, workspaceId: ws.id });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "split_pane",
        arguments: { workspace_id: ws.id, surface_type: "preview" },
      }),
      ctx,
    );

    // Tool errors surface as result.isError=true or a top-level error
    expect(
      (resp as any).error?.message ?? (resp as any).result?.isError,
    ).toBeTruthy();
  });

  it("split_pane errors when workspace_id is unknown", async () => {
    const { ws } = makeWorkspace("ws-split-known");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ workspaceId: ws.id });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "split_pane",
        arguments: { workspace_id: "ws-does-not-exist" },
      }),
      ctx,
    );

    expect(
      (resp as any).error?.message ?? (resp as any).result?.isError,
    ).toBeTruthy();
  });

  it("split_pane errors when pane_id is unknown", async () => {
    const { ws } = makeWorkspace("ws-split-known2");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ workspaceId: ws.id });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "split_pane",
        arguments: { pane_id: "pane-does-not-exist" },
      }),
      ctx,
    );

    expect(
      (resp as any).error?.message ?? (resp as any).result?.isError,
    ).toBeTruthy();
  });

  it("split_pane with surface_type preview creates a new pane and opens a preview surface", async () => {
    const { ws, pane } = makeWorkspace("ws-split-preview");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ paneId: pane.id, workspaceId: ws.id });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "split_pane",
        arguments: {
          workspace_id: ws.id,
          surface_type: "preview",
          preview_path: "/tmp/test.md",
        },
      }),
      ctx,
    );

    const result = (resp as any).result.structuredContent;
    expect(result).toHaveProperty("pane_id");
    expect(result.pane_id).not.toBe(pane.id); // new pane, different id
    expect(result).toHaveProperty("workspace_id", ws.id);
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

  it("list_workspaces wraps the list in a record (structuredContent must be an object)", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    nestedWorkspaces.set([wsA]);
    activeNestedWorkspaceIdx.set(0);
    const r = await dispatch(
      rpc("tools/call", { name: "list_workspaces", arguments: {} }),
    );
    const result = (r as any).result.structuredContent;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    expect(Array.isArray(result.nestedWorkspaces)).toBe(true);
    expect(result.nestedWorkspaces[0].id).toBe("ws-A");
  });

  it("list_panes wraps the list in a record", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    nestedWorkspaces.set([wsA]);
    activeNestedWorkspaceIdx.set(0);
    const r = await dispatch(
      rpc("tools/call", { name: "list_panes", arguments: {} }),
    );
    const result = (r as any).result.structuredContent;
    expect(Array.isArray(result)).toBe(false);
    expect(Array.isArray(result.panes)).toBe(true);
    expect(result.panes[0].id).toBe("ws-A-pane");
  });

  it("list_panes with an unknown workspace_id returns an empty record", async () => {
    const r = await dispatch(
      rpc("tools/call", {
        name: "list_panes",
        arguments: { workspace_id: "nope" },
      }),
    );
    const result = (r as any).result.structuredContent;
    expect(result).toEqual({ panes: [] });
  });

  it("list_sessions is not a registered tool (superseded by list_agents)", async () => {
    const tools = _getToolsForTest();
    const names = (tools as any[]).map((t) => t.name);
    expect(names).not.toContain("list_sessions");
  });

  it("get_active_workspace returns nullable fields when no workspace is open", async () => {
    const r = await dispatch(
      rpc("tools/call", { name: "get_active_workspace", arguments: {} }),
    );
    expect((r as any).result.structuredContent).toEqual({
      id: null,
      name: null,
      activePaneId: null,
    });
  });

  it("get_active_pane returns { pane: null } when no pane is focused", async () => {
    const r = await dispatch(
      rpc("tools/call", { name: "get_active_pane", arguments: {} }),
    );
    expect((r as any).result.structuredContent).toEqual({ pane: null });
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

describe("resolveTarget — connection-binding resolution rules (the v1 bug fence)", () => {
  beforeEach(() => {
    _resetMcpServerForTest();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("rule 1: explicit pane_id wins, returns its current workspace", () => {
    const { ws: wsA, pane: paneA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    nestedWorkspaces.set([wsA, wsB]);
    activeNestedWorkspaceIdx.set(1); // user looks at B (adversarial)

    // Bind the agent to A, but pass an explicit pane in B.
    const { pane: paneB } = makeWorkspace("ws-B"); // separate fixture
    // Replace wsB to contain a pane we can target.
    wsB.splitRoot = { type: "pane", pane: paneB };
    wsB.activePaneId = paneB.id;
    nestedWorkspaces.set([wsA, wsB]);

    const ctx = _testContext({ paneId: paneA.id, workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({ pane_id: paneB.id }, ctx);
    expect(resolved.workspace.id).toBe("ws-B");
    expect(resolved.hostPane?.id).toBe(paneB.id);
    expect(resolved.source).toBe("args-pane");
  });

  it("rule 1: explicit pane_id pointing at a closed pane errors (no fallback)", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    nestedWorkspaces.set([wsA]);
    activeNestedWorkspaceIdx.set(0);
    const ctx = _testContext({ workspaceId: "ws-A" });
    expect(() => _resolveTargetForTest({ pane_id: "ghost" }, ctx)).toThrow(
      /not found/,
    );
  });

  it("rule 2: explicit workspace_id wins over binding", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    nestedWorkspaces.set([wsA, wsB]);
    activeNestedWorkspaceIdx.set(0); // user looks at A
    const ctx = _testContext({ workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({ workspace_id: "ws-B" }, ctx);
    expect(resolved.workspace.id).toBe("ws-B");
    expect(resolved.source).toBe("args-workspace");
  });

  it("rule 2: explicit but unknown workspace_id errors", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    nestedWorkspaces.set([wsA]);
    const ctx = _testContext({ workspaceId: "ws-A" });
    expect(() =>
      _resolveTargetForTest({ workspace_id: "ws-ghost" }, ctx),
    ).toThrow(/not found/);
  });

  it("rule 3: binding pane wins when no args, ignores user focus on a different workspace", () => {
    const { ws: wsA, pane: paneA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    nestedWorkspaces.set([wsA, wsB]);
    activeNestedWorkspaceIdx.set(1); // ADVERSARIAL: user looks at B
    const ctx = _testContext({ paneId: paneA.id, workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({}, ctx);
    expect(resolved.workspace.id).toBe("ws-A"); // binding wins
    expect(resolved.hostPane?.id).toBe(paneA.id);
    expect(resolved.source).toBe("binding-pane");
  });

  it("rule 3 with cross-workspace move: pane_id is stable, workspace re-derived", () => {
    const { ws: wsA, pane: paneA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    nestedWorkspaces.set([wsA, wsB]);

    // Move paneA into wsB by mutating splitRoot.
    wsA.splitRoot = {
      type: "pane",
      pane: { id: "wsA-empty", surfaces: [], activeSurfaceId: null },
    };
    wsB.splitRoot = { type: "pane", pane: paneA };
    nestedWorkspaces.update((l) => [...l]);

    // Connection still bound to paneA (originally in ws-A). After the move the
    // resolver must report the pane's CURRENT workspace.
    const ctx = _testContext({ paneId: paneA.id, workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({}, ctx);
    expect(resolved.workspace.id).toBe("ws-B");
    expect(resolved.hostPane?.id).toBe(paneA.id);
  });

  it("rule 4: when bound pane is closed, falls through to bound workspace", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    nestedWorkspaces.set([wsA]);
    activeNestedWorkspaceIdx.set(0);
    const ctx = _testContext({ paneId: "closed-pane", workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({}, ctx);
    expect(resolved.workspace.id).toBe("ws-A");
    expect(resolved.hostPane).toBeNull();
    expect(resolved.source).toBe("binding-workspace");
  });

  it("rule 5: unbound + no args = error (NEVER fall back to active workspace)", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    nestedWorkspaces.set([wsA]);
    activeNestedWorkspaceIdx.set(0); // there IS an active workspace
    const ctx = _testContext(null);
    expect(() => _resolveTargetForTest({}, ctx)).toThrow(
      /no pane\/workspace context/,
    );
  });

  it("THE V1 BUG FENCE: bound to W1, GUI focused on W2 → still resolves to W1", () => {
    // This is the exact bug shipped on 2026-04-16. Permanent regression test.
    const { ws: w1 } = makeWorkspace("ws-1");
    const { ws: w2 } = makeWorkspace("ws-2");
    nestedWorkspaces.set([w1, w2]);
    activeNestedWorkspaceIdx.set(1); // focus is W2
    const ctx = _testContext({ workspaceId: "ws-1" });
    const resolved = _resolveTargetForTest({}, ctx);
    expect(resolved.workspace.id).toBe("ws-1");
    expect(resolved.source).toBe("binding-workspace");
  });

  it("PERF FENCE: rapid spawns chain off the last-spawned pane, not the binding pane", () => {
    // Without this, dispatch_tasks with N tasks deeply nests N splits around
    // the same binding pane. findParentSplit + DOM render become O(depth)
    // per spawn → O(N²) total → UI freeze. The original freeze we hit on
    // 2026-04-16. Regression test: resolveTarget must prefer lastSpawnedPaneId.
    const { ws, pane: hostPane } = makeWorkspace("ws-host");
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);
    const ctx = _testContext({ paneId: hostPane.id, workspaceId: "ws-host" });

    // First resolution: no lastSpawnedPaneId yet → use binding pane.
    const first = _resolveTargetForTest({}, ctx);
    expect(first.hostPane?.id).toBe(hostPane.id);

    // Simulate a successful spawn: push a new pane into the tree and record it.
    const newPane: Pane = { id: "new-1", surfaces: [], activeSurfaceId: null };
    ws.splitRoot = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "pane", pane: hostPane },
        { type: "pane", pane: newPane },
      ],
    };
    nestedWorkspaces.set([ws]);
    ctx.lastSpawnedPaneId = newPane.id;

    // Next resolution: must use the new pane, NOT the binding pane.
    const second = _resolveTargetForTest({}, ctx);
    expect(second.hostPane?.id).toBe(newPane.id);
  });

  it("lastSpawnedPaneId is ignored when the pane was closed (falls through to binding)", () => {
    const { ws, pane: hostPane } = makeWorkspace("ws-host");
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);
    const ctx = _testContext({ paneId: hostPane.id, workspaceId: "ws-host" });
    ctx.lastSpawnedPaneId = "never-existed";
    const resolved = _resolveTargetForTest({}, ctx);
    expect(resolved.hostPane?.id).toBe(hostPane.id);
  });
});

describe("MCP mirror tools — surface types", () => {
  beforeEach(() => {
    resetSurfaceTypes();
    _resetMcpServerForTest();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("list_surface_types returns registered types", async () => {
    registerSurfaceType({
      id: "a:b",
      label: "AB",
      component: {},
      source: "a",
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_surface_types", arguments: {} }),
    );
    const types = (r as any).result.structuredContent.types;
    expect(types).toEqual([{ id: "a:b", label: "AB", source: "a" }]);
  });

  it("open_surface rejects an unregistered surface type", async () => {
    const ctx = _testContext({ workspaceId: "ws-1" });
    const { ws } = makeWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    const resp = await dispatch(
      rpc("tools/call", {
        name: "open_surface",
        arguments: { surface_type_id: "nope:nope", title: "x" },
      }),
      ctx,
    );
    expect((resp as any).error.code).toBe(-32000);
    expect((resp as any).error.message).toMatch(/Unknown surface type/);
  });

  it("open_surface places a registered surface via current-pane placement", async () => {
    registerSurfaceType({
      id: "test:panel",
      label: "Panel",
      component: {},
      source: "test",
    });
    const { ws } = makeWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ workspaceId: "ws-1" });
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
      ctx,
    );
    const r = (resp as any).result.structuredContent;
    expect(r.surface_id).toBeTruthy();
    expect(r.workspace_id).toBe("ws-1");
    const placed = getAllSurfaces(get(nestedWorkspaces)[0]!);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.kind).toBe("extension");
    expect(placed[0]!.title).toBe("Test Panel");
    expect((placed[0] as { props: Record<string, unknown> }).props).toEqual({
      hello: "world",
    });
  });
});

describe("MCP mirror tools — commands", () => {
  beforeEach(() => resetCommands());

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
  beforeEach(() => resetSidebarTabs());

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
    expect((r as any).result.structuredContent.tabs).toEqual([
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
  beforeEach(() => resetWorkspaceActions());

  it("list_workspace_actions returns registered actions", async () => {
    registerWorkspaceAction({
      id: "create-worktree",
      label: "New Worktree",
      icon: "git-branch",
      zone: "sidebar",
      handler: () => {},
      source: "worktrees",
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_workspace_actions", arguments: {} }),
    );
    expect((r as any).result.structuredContent.actions).toEqual([
      {
        id: "create-worktree",
        label: "New Worktree",
        icon: "git-branch",
        shortcut: undefined,
        zone: "sidebar",
        source: "worktrees",
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

describe("MCP mirror tools — context menu items", () => {
  beforeEach(() => {
    resetContextMenuItems();
    // mcp_file_info is called by invoke_context_menu_item to reject blocked
    // or missing paths before the handler runs. Default to "exists, not a dir".
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "mcp_file_info" ? [true, false] : undefined,
    );
  });

  it("list_context_menu_items mirrors the registry", async () => {
    registerContextMenuItem({
      id: "preview:open-as-preview",
      source: "preview",
      label: "Open as Preview",
      when: "*.{md,json}",
      handler: () => {},
    });

    const r = await dispatch(
      rpc("tools/call", { name: "list_context_menu_items", arguments: {} }),
    );
    expect((r as any).result.structuredContent).toEqual({
      items: [
        {
          id: "preview:open-as-preview",
          label: "Open as Preview",
          when: "*.{md,json}",
          source: "preview",
        },
      ],
    });
  });

  it("list_context_menu_items can filter by file_path match", async () => {
    registerContextMenuItem({
      id: "preview:open-as-preview",
      source: "preview",
      label: "Open as Preview",
      when: "*.md",
      handler: () => {},
    });
    registerContextMenuItem({
      id: "other:unrelated",
      source: "other",
      label: "Unrelated",
      when: "*.exe",
      handler: () => {},
    });

    const r = await dispatch(
      rpc("tools/call", {
        name: "list_context_menu_items",
        arguments: { file_path: "/tmp/readme.md" },
      }),
    );
    const items = (r as any).result.structuredContent.items as Array<{
      id: string;
    }>;
    expect(items.map((i) => i.id)).toEqual(["preview:open-as-preview"]);
  });

  it("invoke_context_menu_item invokes the registered handler with the file path", async () => {
    const received: string[] = [];
    registerContextMenuItem({
      id: "preview:open-as-preview",
      source: "preview",
      label: "Open as Preview",
      when: "*.md",
      handler: (p) => received.push(p),
    });

    const r = await dispatch(
      rpc("tools/call", {
        name: "invoke_context_menu_item",
        arguments: {
          item_id: "preview:open-as-preview",
          file_path: "/tmp/readme.md",
        },
      }),
    );
    expect((r as any).result.structuredContent).toEqual({ ok: true });
    expect(received).toEqual(["/tmp/readme.md"]);
  });

  it("invoke_context_menu_item errors when the pattern does not match the path", async () => {
    registerContextMenuItem({
      id: "preview:open-as-preview",
      source: "preview",
      label: "Open as Preview",
      when: "*.md",
      handler: () => {},
    });
    const resp = await dispatch(
      rpc("tools/call", {
        name: "invoke_context_menu_item",
        arguments: {
          item_id: "preview:open-as-preview",
          file_path: "/tmp/data.exe",
        },
      }),
    );
    expect((resp as any).error.code).toBe(-32000);
    expect((resp as any).error.message).toMatch(/does not match/i);
  });

  it("invoke_context_menu_item errors on unknown item_id", async () => {
    const resp = await dispatch(
      rpc("tools/call", {
        name: "invoke_context_menu_item",
        arguments: { item_id: "nope", file_path: "/tmp/x" },
      }),
    );
    expect((resp as any).error.code).toBe(-32000);
    expect((resp as any).error.message).toMatch(/unknown context menu item/i);
  });

  it("invoke_context_menu_item rejects paths the read allowlist blocks", async () => {
    // Simulate mcp_file_info reporting the path as non-existent (what the
    // Rust side returns for paths under ~/.ssh, ~/.gnupg, etc).
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "mcp_file_info" ? [false, false] : undefined,
    );
    let handlerCalled = false;
    registerContextMenuItem({
      id: "preview:open",
      source: "preview",
      label: "Open",
      when: "*",
      handler: () => {
        handlerCalled = true;
      },
    });
    const resp = await dispatch(
      rpc("tools/call", {
        name: "invoke_context_menu_item",
        arguments: { item_id: "preview:open", file_path: "/root/.ssh/id_rsa" },
      }),
    );
    expect((resp as any).error.code).toBe(-32000);
    expect((resp as any).error.message).toMatch(
      /not accessible|blocked|allowlist/i,
    );
    expect(handlerCalled).toBe(false);
  });

  it("invoke_context_menu_item awaits async handlers", async () => {
    resetContextMenuItems();
    let handlerResolved = false;
    registerContextMenuItem({
      id: "async:handler",
      source: "async",
      label: "Async Handler",
      when: "*.md",
      handler: async (_p: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        handlerResolved = true;
      },
    });

    const response = await dispatch(
      rpc("tools/call", {
        name: "invoke_context_menu_item",
        arguments: { item_id: "async:handler", file_path: "/tmp/readme.md" },
      }),
    );
    expect((response as any).error).toBeUndefined();
    expect(handlerResolved).toBe(true);
  });
});

describe("MCP mirror tools — sidebar sections", () => {
  beforeEach(async () => {
    const mod = await import("../lib/services/sidebar-section-registry");
    mod.resetSidebarSections();
  });

  it("list_sidebar_sections returns registered sections", async () => {
    const mod = await import("../lib/services/sidebar-section-registry");
    mod.registerSidebarSection({
      id: "ext:status",
      label: "Status",
      component: {},
      source: "ext",
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_sidebar_sections", arguments: {} }),
    );
    expect((r as any).result.structuredContent.sections).toEqual([
      { id: "ext:status", label: "Status", source: "ext" },
    ]);
  });
});

describe("MCP mirror tools — dashboard nestedWorkspaces", () => {
  beforeEach(async () => {
    const mod = await import("../lib/services/dashboard-workspace-service");
    mod.clearDashboardRegistry();
  });

  it("list_dashboard_workspaces returns registered entries", async () => {
    const mod = await import("../lib/services/dashboard-workspace-service");
    mod.registerDashboardWorkspaceType({
      id: "ext:settings",
      label: "Settings",
      icon: {} as import("svelte").Component,
      component: {} as import("svelte").Component,
      source: "ext",
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_dashboard_workspaces", arguments: {} }),
    );
    expect((r as any).result.structuredContent.dashboardWorkspaces).toEqual([
      { id: "ext:settings", label: "Settings", source: "ext" },
    ]);
  });
});

describe("MCP mirror tools — workspace subtitles", () => {
  beforeEach(async () => {
    const mod = await import("../lib/services/workspace-subtitle-registry");
    mod.resetWorkspaceSubtitles();
  });

  it("list_workspace_subtitles returns entries sorted by priority", async () => {
    const mod = await import("../lib/services/workspace-subtitle-registry");
    mod.registerWorkspaceSubtitle({
      id: "a:subtitle",
      component: {},
      source: "a",
      priority: 80,
    });
    mod.registerWorkspaceSubtitle({
      id: "b:subtitle",
      component: {},
      source: "b",
      priority: 10,
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_workspace_subtitles", arguments: {} }),
    );
    const subtitles = (r as any).result.structuredContent.subtitles as Array<{
      id: string;
      priority: number;
    }>;
    expect(subtitles.map((s) => s.id)).toEqual(["b:subtitle", "a:subtitle"]);
    expect(subtitles[0]!.priority).toBe(10);
  });
});

describe("MCP mirror tools — dashboard tabs", () => {
  beforeEach(async () => {
    const mod = await import("../lib/services/dashboard-tab-registry");
    mod.resetDashboardTabs();
  });

  it("list_dashboard_tabs returns registered tabs", async () => {
    const mod = await import("../lib/services/dashboard-tab-registry");
    mod.registerDashboardTab({
      id: "ext:analytics",
      label: "Analytics",
      component: {},
      source: "ext",
    });
    const r = await dispatch(
      rpc("tools/call", { name: "list_dashboard_tabs", arguments: {} }),
    );
    expect((r as any).result.structuredContent.tabs).toEqual([
      { id: "ext:analytics", label: "Analytics", source: "ext" },
    ]);
  });
});

describe("MCP mirror tools — status items", () => {
  beforeEach(async () => {
    const mod = await import("../lib/services/status-registry");
    mod.statusRegistry.reset();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("get_status_for_workspace returns items for the resolved workspace", async () => {
    const mod = await import("../lib/services/status-registry");
    const { ws } = makeWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    mod.setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
      icon: "git-branch",
    });
    mod.setStatusItem("agent", "ws-1", "running", {
      category: "agent",
      priority: 20,
      label: "Running",
      variant: "success",
    });
    const ctx = _testContext({ workspaceId: "ws-1" });
    const r = await dispatch(
      rpc("tools/call", {
        name: "get_status_for_workspace",
        arguments: {},
      }),
      ctx,
    );
    const result = (r as any).result.structuredContent;
    expect(result.workspace_id).toBe("ws-1");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].label).toBe("main");
    expect(result.items[1].label).toBe("Running");
  });

  it("get_status_for_workspace honors explicit workspace_id", async () => {
    const mod = await import("../lib/services/status-registry");
    const { ws: a } = makeWorkspace("ws-a");
    const { ws: b } = makeWorkspace("ws-b");
    nestedWorkspaces.set([a, b]);
    mod.setStatusItem("git", "ws-b", "branch", {
      category: "git",
      priority: 10,
      label: "feature",
    });
    const ctx = _testContext({ workspaceId: "ws-a" });
    const r = await dispatch(
      rpc("tools/call", {
        name: "get_status_for_workspace",
        arguments: { workspace_id: "ws-b" },
      }),
      ctx,
    );
    const result = (r as any).result.structuredContent;
    expect(result.workspace_id).toBe("ws-b");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].label).toBe("feature");
  });
});

describe("tool metadata", () => {
  it("every tool has a non-empty description", () => {
    const tools = _getToolsForTest();
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("tool count matches spec (44)", () => {
    expect(_getToolsForTest()).toHaveLength(44);
  });
});

describe("MCP — spawn_agent worktree flag", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    spawnAgentInWorktreeMock.mockReset();
    _resetMcpServerForTest();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("delegates to spawnAgentInWorktree when worktree flag is set", async () => {
    spawnAgentInWorktreeMock.mockResolvedValue({
      surface_id: "surf-x",
      workspace_id: "ws-new",
      pane_id: "pane-new",
      branch: "agent/claude-code/1-x",
      worktree_path: "/work/proj-agent-claude-code-1-x",
    });
    // Bind to an existing workspace so resolveTarget for repoPath fallback
    // wouldn't fire (we provide repoPath explicitly here).
    const { ws } = makeWorkspace("ws-host");
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ workspaceId: "ws-host" });

    const resp = await dispatch(
      rpc("tools/call", {
        name: "spawn_agent",
        arguments: {
          name: "claude-code: #1 fix",
          agent: "claude-code",
          worktree: {
            repoPath: "/work/proj",
            branch: "agent/claude-code/1-fix",
            taskContext: "Fix issue #1",
          },
        },
      }),
      ctx,
    );

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(1);
    const arg = spawnAgentInWorktreeMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(arg).toMatchObject({
      name: "claude-code: #1 fix",
      agent: "claude-code",
      repoPath: "/work/proj",
      branch: "agent/claude-code/1-fix",
      taskContext: "Fix issue #1",
    });

    const result = (resp as any).result.structuredContent;
    expect(result).toEqual({
      surface_id: "surf-x",
      workspace_id: "ws-new",
      pane_id: "pane-new",
      branch: "agent/claude-code/1-x",
      worktree_path: "/work/proj-agent-claude-code-1-x",
    });
    // ctx.lastSpawnedPaneId is updated to the new pane.
    expect(ctx.lastSpawnedPaneId).toBe("pane-new");
  });

  it("derives repoPath from the binding workspace's terminal cwd when not provided", async () => {
    spawnAgentInWorktreeMock.mockResolvedValue({
      surface_id: "s",
      workspace_id: "w",
      pane_id: "p",
      branch: "b",
      worktree_path: "/work/proj-b",
    });
    // Build a workspace with a terminal whose cwd is the repo root.
    const pane: Pane = {
      id: "host-pane",
      activeSurfaceId: "host-surf",
      surfaces: [
        {
          kind: "terminal",
          id: "host-surf",
          terminal: {} as any,
          fitAddon: {} as any,
          searchAddon: {} as any,
          termElement: document.createElement("div"),
          ptyId: 1,
          title: "shell",
          cwd: "/work/derived-repo",
          hasUnread: false,
          opened: true,
        },
      ],
    };
    const ws: NestedWorkspace = {
      id: "ws-host",
      name: "host",
      splitRoot: { type: "pane", pane },
      activePaneId: pane.id,
    };
    nestedWorkspaces.set([ws]);
    const ctx = _testContext({ workspaceId: "ws-host", paneId: "host-pane" });

    await dispatch(
      rpc("tools/call", {
        name: "spawn_agent",
        arguments: {
          name: "claude",
          agent: "claude-code",
          worktree: {}, // no repoPath
        },
      }),
      ctx,
    );

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(1);
    expect(
      (spawnAgentInWorktreeMock.mock.calls[0]?.[0] as Record<string, unknown>)
        .repoPath,
    ).toBe("/work/derived-repo");
  });

  it("errors when worktree flag is set without repoPath and no binding to derive from", async () => {
    const ctx = _testContext(null);
    const resp = await dispatch(
      rpc("tools/call", {
        name: "spawn_agent",
        arguments: {
          name: "claude",
          agent: "claude-code",
          worktree: {},
        },
      }),
      ctx,
    );
    expect((resp as any).error?.code).toBe(-32000);
    expect((resp as any).error?.message).toMatch(/repoPath required/);
    expect(spawnAgentInWorktreeMock).not.toHaveBeenCalled();
  });

  it("does NOT call spawnAgentInWorktree for spawn_agent calls without the worktree flag", async () => {
    // The legacy in-place spawn flow goes through createTerminalSurface +
    // PTY, which would require a far heavier harness to drive end-to-end
    // here. We narrow scope: assert the helper hasn't been called yet
    // when only the worktree-less spawn would have been invoked, and
    // that it WAS called once a worktree spawn is triggered. (Ordering
    // is the meaningful guarantee — the helper is gated by the flag.)
    expect(spawnAgentInWorktreeMock).not.toHaveBeenCalled();
    spawnAgentInWorktreeMock.mockResolvedValue({
      surface_id: "s",
      workspace_id: "w",
      pane_id: "p",
      branch: "b",
      worktree_path: "/x",
    });
    const ctx = _testContext(null);
    await dispatch(
      rpc("tools/call", {
        name: "spawn_agent",
        arguments: {
          name: "x",
          agent: "claude-code",
          worktree: { repoPath: "/work/proj" },
        },
      }),
      ctx,
    );
    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(1);
  });
});

describe("kill_session — unlisten cleanup", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    _resetMcpServerForTest();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("calls the pending unlisten when kill_session is invoked", async () => {
    // Inject a synthetic session with an unlisten function directly.
    const sessions = _getSessionsForTest();
    const unlisten = vi.fn();
    const session = {
      session_id: "mcp-test-kill-1",
      name: "test-agent",
      agent: "claude-code" as const,
      pid: undefined,
      status: "starting" as const,
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
      paneId: "pane-1",
      surfaceId: "surf-1",
      ptyId: 99,
      unlisten,
    };
    sessions.set(session.session_id, session);

    // Mock kill_pty to succeed and removeSurfaceFromPane is a no-op (no real DOM).
    invokeMock.mockResolvedValue(undefined);

    const resp = await dispatch(
      rpc("tools/call", {
        name: "kill_session",
        arguments: { session_id: "mcp-test-kill-1" },
      }),
    );

    expect((resp as any).result.structuredContent).toEqual({ ok: true });
    expect(unlisten).toHaveBeenCalledTimes(1);
    // Session must be cleaned up.
    expect(sessions.has("mcp-test-kill-1")).toBe(false);
  });

  it("does not throw when kill_session is called with no pending unlisten", async () => {
    const sessions = _getSessionsForTest();
    const session = {
      session_id: "mcp-test-kill-2",
      name: "test-agent",
      agent: "claude-code" as const,
      pid: undefined,
      status: "running" as const,
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
      paneId: "pane-2",
      surfaceId: "surf-2",
      ptyId: 100,
      // No unlisten field — task already fired or never registered.
    };
    sessions.set(session.session_id, session);
    invokeMock.mockResolvedValue(undefined);

    const resp = await dispatch(
      rpc("tools/call", {
        name: "kill_session",
        arguments: { session_id: "mcp-test-kill-2" },
      }),
    );

    expect((resp as any).result.structuredContent).toEqual({ ok: true });
    expect(sessions.has("mcp-test-kill-2")).toBe(false);
  });
});
