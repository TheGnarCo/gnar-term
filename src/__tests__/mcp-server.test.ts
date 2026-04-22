/**
 * MCP server unit tests. Adversarial coverage of the connection-binding
 * contract: every test that exercises a UI-mutating tool sets ambient state
 * (active workspace, user focus) DIFFERENTLY from the test's expectation, so
 * that any future code that quietly reads ambient state for routing fails.
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
  _getToolsForTest,
  _testContext,
  _resolveTargetForTest,
  _resetMcpServerForTest,
} from "../lib/services/mcp-server";
import {
  extensionSidebarSections,
  _resetExtensionSidebarForTest,
} from "../lib/stores/extension-sidebar";
import { _resetEventBufferForTest } from "../lib/services/mcp-event-buffer";
import {
  workspaces,
  activeWorkspaceIdx,
} from "../lib/stores/workspace";
import type { Workspace, Pane } from "../lib/types";

function rpc(method: string, params?: unknown, id: number = 1) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

/** Build a deterministic workspace fixture with a given id and a single pane. */
function makeWorkspace(id: string, name = id): { ws: Workspace; pane: Pane } {
  const pane: Pane = { id: `${id}-pane`, surfaces: [], activeSurfaceId: null };
  const ws: Workspace = {
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
    _resetExtensionSidebarForTest();
    _resetEventBufferForTest();
    _resetMcpServerForTest();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("responds to initialize with server info and protocol version", async () => {
    const resp = await dispatch(rpc("initialize"));
    expect(resp).toBeTruthy();
    expect((resp as any).result.protocolVersion).toBe("2025-11-25");
    expect((resp as any).result.serverInfo.name).toBe("gnar-term");
    expect((resp as any).result.capabilities.tools).toBeDefined();
  });

  it("lists all 20 tools with correct names (includes get_agent_context)", async () => {
    const resp = await dispatch(rpc("tools/list"));
    const tools = (resp as any).result.tools as Array<{ name: string }>;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_preview",
        "dispatch_tasks",
        "file_exists",
        "get_active_pane",
        "get_active_workspace",
        "get_agent_context",
        "get_session_info",
        "kill_session",
        "list_dir",
        "list_panes",
        "list_sessions",
        "list_workspaces",
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
    expect(names).toHaveLength(20);
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
    workspaces.set([wsA, wsB]);
    activeWorkspaceIdx.set(0); // user is looking at A

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
    const map = get(extensionSidebarSections);
    expect(map.size).toBe(1);
    const section = map.get("ws-B:secondary:s1");
    expect(section?.workspaceId).toBe("ws-B");
    expect(section?.title).toBe("S1");
  });

  it("render_sidebar uses the connection binding when no workspace_id is passed", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    workspaces.set([wsA, wsB]);
    activeWorkspaceIdx.set(0); // user looks at A

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
    const map = get(extensionSidebarSections);
    expect(map.has("ws-B:primary:s1")).toBe(true);
    expect(map.has("ws-A:primary:s1")).toBe(false);
  });

  it("render_sidebar errors clearly when unbound and no workspace_id passed", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    workspaces.set([wsA]);
    activeWorkspaceIdx.set(0); // there IS an active workspace, but agent is unbound

    const ctx = _testContext(null);
    const resp = await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: { side: "secondary", section_id: "x", title: "X", items: [] },
      }),
      ctx,
    );
    // Resolution rule 5: must error, NOT silently target the active workspace.
    expect((resp as any).error?.code).toBe(-32000);
    expect((resp as any).error?.message).toMatch(/no pane\/workspace context/);
    expect(get(extensionSidebarSections).size).toBe(0);
  });

  it("remove_sidebar_section uses the binding workspace", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    workspaces.set([wsA]);
    activeWorkspaceIdx.set(0);

    const ctx = _testContext({ workspaceId: "ws-A" });
    await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: { side: "primary", section_id: "x", title: "X", items: [] },
      }),
      ctx,
    );
    expect(get(extensionSidebarSections).size).toBe(1);

    const resp = await dispatch(
      rpc("tools/call", {
        name: "remove_sidebar_section",
        arguments: { side: "primary", section_id: "x" },
      }),
      ctx,
    );
    expect((resp as any).result.structuredContent.ok).toBe(true);
    expect(get(extensionSidebarSections).size).toBe(0);
  });

  it("poll_events returns the cursor and events array", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    workspaces.set([wsA]);
    activeWorkspaceIdx.set(0);
    const ctx = _testContext({ workspaceId: "ws-A" });
    await dispatch(
      rpc("tools/call", {
        name: "render_sidebar",
        arguments: { side: "primary", section_id: "x", title: "X", items: [] },
      }),
      ctx,
    );
    const resp = await dispatch(rpc("tools/call", { name: "poll_events", arguments: {} }));
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
    expect((r as any).result.structuredContent).toEqual({ exists: true, is_dir: true });

    invokeMock.mockResolvedValueOnce([false, false]);
    const r2 = await dispatch(
      rpc("tools/call", { name: "file_exists", arguments: { path: "/nope" } }),
    );
    expect((r2 as any).result.structuredContent).toEqual({ exists: false });
  });

  it("list_workspaces wraps the list in a record (structuredContent must be an object)", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    workspaces.set([wsA]);
    activeWorkspaceIdx.set(0);
    const r = await dispatch(rpc("tools/call", { name: "list_workspaces", arguments: {} }));
    const result = (r as any).result.structuredContent;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    expect(Array.isArray(result.workspaces)).toBe(true);
    expect(result.workspaces[0].id).toBe("ws-A");
  });

  it("list_panes wraps the list in a record", async () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    workspaces.set([wsA]);
    activeWorkspaceIdx.set(0);
    const r = await dispatch(rpc("tools/call", { name: "list_panes", arguments: {} }));
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

  it("list_sessions wraps the list in a record", async () => {
    const r = await dispatch(rpc("tools/call", { name: "list_sessions", arguments: {} }));
    const result = (r as any).result.structuredContent;
    expect(Array.isArray(result)).toBe(false);
    expect(Array.isArray(result.sessions)).toBe(true);
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
    const resp = await dispatch(rpc("tools/call", { name: "nope", arguments: {} }));
    expect((resp as any).error.code).toBe(-32601);
  });
});

describe("resolveTarget — connection-binding resolution rules (the v1 bug fence)", () => {
  beforeEach(() => {
    _resetMcpServerForTest();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("rule 1: explicit pane_id wins, returns its current workspace", () => {
    const { ws: wsA, pane: paneA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    workspaces.set([wsA, wsB]);
    activeWorkspaceIdx.set(1); // user looks at B (adversarial)

    // Bind the agent to A, but pass an explicit pane in B.
    const { pane: paneB } = makeWorkspace("ws-B"); // separate fixture
    // Replace wsB to contain a pane we can target.
    wsB.splitRoot = { type: "pane", pane: paneB };
    wsB.activePaneId = paneB.id;
    workspaces.set([wsA, wsB]);

    const ctx = _testContext({ paneId: paneA.id, workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({ pane_id: paneB.id }, ctx);
    expect(resolved.workspace.id).toBe("ws-B");
    expect(resolved.hostPane?.id).toBe(paneB.id);
    expect(resolved.source).toBe("args-pane");
  });

  it("rule 1: explicit pane_id pointing at a closed pane errors (no fallback)", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    workspaces.set([wsA]);
    activeWorkspaceIdx.set(0);
    const ctx = _testContext({ workspaceId: "ws-A" });
    expect(() => _resolveTargetForTest({ pane_id: "ghost" }, ctx)).toThrow(/not found/);
  });

  it("rule 2: explicit workspace_id wins over binding", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    workspaces.set([wsA, wsB]);
    activeWorkspaceIdx.set(0); // user looks at A
    const ctx = _testContext({ workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({ workspace_id: "ws-B" }, ctx);
    expect(resolved.workspace.id).toBe("ws-B");
    expect(resolved.source).toBe("args-workspace");
  });

  it("rule 2: explicit but unknown workspace_id errors", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    workspaces.set([wsA]);
    const ctx = _testContext({ workspaceId: "ws-A" });
    expect(() => _resolveTargetForTest({ workspace_id: "ws-ghost" }, ctx)).toThrow(/not found/);
  });

  it("rule 3: binding pane wins when no args, ignores user focus on a different workspace", () => {
    const { ws: wsA, pane: paneA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    workspaces.set([wsA, wsB]);
    activeWorkspaceIdx.set(1); // ADVERSARIAL: user looks at B
    const ctx = _testContext({ paneId: paneA.id, workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({}, ctx);
    expect(resolved.workspace.id).toBe("ws-A"); // binding wins
    expect(resolved.hostPane?.id).toBe(paneA.id);
    expect(resolved.source).toBe("binding-pane");
  });

  it("rule 3 with cross-workspace move: pane_id is stable, workspace re-derived", () => {
    const { ws: wsA, pane: paneA } = makeWorkspace("ws-A");
    const { ws: wsB } = makeWorkspace("ws-B");
    workspaces.set([wsA, wsB]);

    // Move paneA into wsB by mutating splitRoot.
    wsA.splitRoot = { type: "pane", pane: { id: "wsA-empty", surfaces: [], activeSurfaceId: null } };
    wsB.splitRoot = { type: "pane", pane: paneA };
    workspaces.update((l) => [...l]);

    // Connection still bound to paneA (originally in ws-A). After the move the
    // resolver must report the pane's CURRENT workspace.
    const ctx = _testContext({ paneId: paneA.id, workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({}, ctx);
    expect(resolved.workspace.id).toBe("ws-B");
    expect(resolved.hostPane?.id).toBe(paneA.id);
  });

  it("rule 4: when bound pane is closed, falls through to bound workspace", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    workspaces.set([wsA]);
    activeWorkspaceIdx.set(0);
    const ctx = _testContext({ paneId: "closed-pane", workspaceId: "ws-A" });
    const resolved = _resolveTargetForTest({}, ctx);
    expect(resolved.workspace.id).toBe("ws-A");
    expect(resolved.hostPane).toBeNull();
    expect(resolved.source).toBe("binding-workspace");
  });

  it("rule 5: unbound + no args = error (NEVER fall back to active workspace)", () => {
    const { ws: wsA } = makeWorkspace("ws-A");
    workspaces.set([wsA]);
    activeWorkspaceIdx.set(0); // there IS an active workspace
    const ctx = _testContext(null);
    expect(() => _resolveTargetForTest({}, ctx)).toThrow(/no pane\/workspace context/);
  });

  it("THE V1 BUG FENCE: bound to W1, GUI focused on W2 → still resolves to W1", () => {
    // This is the exact bug shipped on 2026-04-16. Permanent regression test.
    const { ws: w1 } = makeWorkspace("ws-1");
    const { ws: w2 } = makeWorkspace("ws-2");
    workspaces.set([w1, w2]);
    activeWorkspaceIdx.set(1); // focus is W2
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
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
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
    workspaces.set([ws]);
    ctx.lastSpawnedPaneId = newPane.id;

    // Next resolution: must use the new pane, NOT the binding pane.
    const second = _resolveTargetForTest({}, ctx);
    expect(second.hostPane?.id).toBe(newPane.id);
  });

  it("lastSpawnedPaneId is ignored when the pane was closed (falls through to binding)", () => {
    const { ws, pane: hostPane } = makeWorkspace("ws-host");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
    const ctx = _testContext({ paneId: hostPane.id, workspaceId: "ws-host" });
    ctx.lastSpawnedPaneId = "never-existed";
    const resolved = _resolveTargetForTest({}, ctx);
    expect(resolved.hostPane?.id).toBe(hostPane.id);
  });
});

describe("tool metadata", () => {
  it("every tool has a non-empty description", () => {
    const tools = _getToolsForTest();
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("tool count matches spec (20)", () => {
    expect(_getToolsForTest()).toHaveLength(20);
  });
});
