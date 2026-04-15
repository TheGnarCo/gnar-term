import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeServer } from "../bridge-server.js";
import type { SpawnOptions } from "../types.js";

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function successResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function forward<T = unknown>(bridge: BridgeServer, op: string, params: unknown) {
  try {
    const result = await bridge.request<T>(op, params);
    return successResult(result);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export function registerSessionTools(server: McpServer, bridge: BridgeServer): void {
  server.registerTool(
    "spawn_agent",
    {
      description:
        "Start an AI coding agent CLI in a new Gnar Term pane. Returns a session ID for subsequent interaction.",
      inputSchema: {
        name: z.string().describe("Human-readable session label"),
        agent: z
          .enum(["claude-code", "codex", "aider", "custom"])
          .describe("Agent CLI to launch"),
        task: z
          .string()
          .optional()
          .describe("Initial prompt to send after startup delay"),
        cwd: z.string().optional().describe("Working directory for the session"),
        command: z
          .string()
          .optional()
          .describe('Shell command to run (required when agent is "custom")'),
        env: z
          .record(z.string())
          .optional()
          .describe("Additional environment variables"),
        cols: z.number().optional().describe("Terminal columns"),
        rows: z.number().optional().describe("Terminal rows"),
      },
    },
    async (args) => {
      const opts = args as unknown as SpawnOptions;
      if (opts.agent === "custom" && !opts.command) {
        return errorResult('agent "custom" requires a command parameter');
      }
      return forward(bridge, "spawn_pane", opts);
    },
  );

  server.registerTool(
    "list_sessions",
    {
      description:
        "List all active MCP-spawned sessions in Gnar Term with their current status, PID, and working directory.",
    },
    async () => forward(bridge, "list_sessions", {}),
  );

  server.registerTool(
    "get_session_info",
    {
      description:
        "Get detailed information about a specific session including output buffer stats.",
      inputSchema: {
        session_id: z.string().describe("Session ID returned by spawn_agent"),
      },
    },
    async ({ session_id }: { session_id: string }) =>
      forward(bridge, "get_session_info", { session_id }),
  );

  server.registerTool(
    "kill_session",
    {
      description:
        "Terminate a session and close its Gnar Term pane.",
      inputSchema: {
        session_id: z.string().describe("Session ID to terminate"),
        signal: z
          .string()
          .optional()
          .describe("Signal to send (default: SIGTERM)"),
      },
    },
    async ({ session_id, signal }: { session_id: string; signal?: string }) =>
      forward(bridge, "kill_session", { session_id, signal }),
  );
}
