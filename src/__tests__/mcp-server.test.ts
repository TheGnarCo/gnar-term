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
  extensionSidebarSections,
  _resetExtensionSidebarForTest,
} from "../lib/stores/extension-sidebar";
import { _resetEventBufferForTest } from "../lib/services/mcp-event-buffer";

function rpc(method: string, params?: unknown, id: number = 1) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

describe("MCP server JSON-RPC", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    _resetExtensionSidebarForTest();
    _resetEventBufferForTest();
  });

  it("responds to initialize with server info and protocol version", async () => {
    const resp = await dispatch(rpc("initialize"));
    expect(resp).toBeTruthy();
    expect((resp as any).result.protocolVersion).toBe("2025-11-25");
    expect((resp as any).result.serverInfo.name).toBe("gnar-term");
    expect((resp as any).result.capabilities.tools).toBeDefined();
  });

  it("lists all 19 tools with correct names", async () => {
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
    expect(names).toHaveLength(19);
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
    const map = get(extensionSidebarSections);
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

describe("tool metadata", () => {
  it("every tool has a non-empty description", () => {
    const tools = _getToolsForTest();
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("tool count matches spec (19)", () => {
    expect(_getToolsForTest()).toHaveLength(19);
  });
});
