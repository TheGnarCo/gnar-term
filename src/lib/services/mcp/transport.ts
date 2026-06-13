/**
 * JSON-RPC 2.0 framing and dispatch for the MCP server.
 *
 * Hand-rolled rather than pulling in `@modelcontextprotocol/sdk`: the SDK
 * targets Node, and the surface area is tiny.
 */
import { getTools } from "./registry";
import { ANONYMOUS_CONTEXT } from "./types";
import type { ConnectionContext, JsonRpcRequest, JsonRpcResponse } from "./types";
import { logDispatch, type DispatchLogEntry } from "./dispatch-log";

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = { name: "gnar-term", version: "0.3.1" };

/** Tools that mutate UI surfaces — these are the ones that get logged to
 *  dispatchLog with binding/resolution metadata. */
const UI_MUTATING_TOOLS = new Set([
  "spawn_agent",
  "dispatch_tasks",
  "create_preview",
  "render_sidebar",
  "remove_sidebar_section",
]);

export async function dispatch(
  req: JsonRpcRequest,
  ctx: ConnectionContext = ANONYMOUS_CONTEXT,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined || req.id === null;

  try {
    switch (req.method) {
      case "initialize": {
        const result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        };
        return isNotification ? null : { jsonrpc: "2.0", id, result };
      }
      case "$/gnar-term/hello": {
        // Connection-binding handshake. Always a notification (no id).
        const params = (req.params ?? {}) as {
          pane_id?: string | null;
          workspace_id?: string | null;
          client_pid?: number | null;
        };
        ctx.binding = {
          paneId: params.pane_id ?? null,
          workspaceId: params.workspace_id ?? null,
          clientPid: params.client_pid ?? null,
        };
        return null;
      }
      case "notifications/initialized":
      case "initialized":
        return null;
      case "tools/list": {
        const tools = getTools().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return isNotification ? null : { jsonrpc: "2.0", id, result: { tools } };
      }
      case "tools/call": {
        const params = (req.params ?? {}) as {
          name: string;
          arguments?: Record<string, unknown>;
        };
        const tool = getTools().find((t) => t.name === params.name);
        if (!tool) {
          if (isNotification) return null;
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `unknown tool: ${params.name}` },
          };
        }
        const args = params.arguments ?? {};
        const shouldLog = UI_MUTATING_TOOLS.has(tool.name);
        const logEntry: DispatchLogEntry | null = shouldLog
          ? {
              ts: new Date().toISOString(),
              connectionId: ctx.connectionId,
              tool: tool.name,
              binding: ctx.binding,
              args,
            }
          : null;
        try {
          const value = await tool.handler(args, ctx);
          if (logEntry) {
            // Try to surface the resolution metadata when the result includes it.
            const v = value as
              | { workspace_id?: string; pane_id?: string }
              | undefined
              | null;
            if (v && v.workspace_id) {
              logEntry.resolved = {
                workspaceId: v.workspace_id,
                paneId: v.pane_id ?? null,
                source: "tool-result",
              };
            }
            logEntry.result = { kind: "ok", summary: JSON.stringify(value).slice(0, 120) };
            logDispatch(logEntry);
          }
          if (isNotification) return null;
          // MCP spec requires `structuredContent` to be a JSON object (record).
          // Arrays, null, and primitives are rejected by client-side Zod
          // validators, so only attach structuredContent when the tool returned
          // a plain object. Text `content` still carries the full JSON payload.
          const isRecord =
            value !== null && typeof value === "object" && !Array.isArray(value);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(value) }],
              ...(isRecord ? { structuredContent: value } : {}),
            },
          };
        } catch (err) {
          if (logEntry) {
            logEntry.result = {
              kind: "error",
              message: err instanceof Error ? err.message : String(err),
            };
            logDispatch(logEntry);
          }
          throw err;
        }
      }
      case "ping":
        return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
      default:
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${req.method}` },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNotification) {
      console.warn("[mcp] notification handler threw:", message);
      return null;
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message },
    };
  }
}
