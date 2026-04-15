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

export function registerOrchestrationTools(server: McpServer, bridge: BridgeServer): void {
  server.registerTool(
    "dispatch_tasks",
    {
      description:
        "Spawn multiple sessions in parallel, each with its own task, as Gnar Term panes.",
      inputSchema: {
        tasks: z
          .array(
            z.object({
              name: z.string().describe("Session label"),
              agent: z
                .enum(["claude-code", "codex", "aider", "custom"])
                .describe("Agent CLI to launch"),
              task: z.string().describe("Prompt to send to the agent"),
              cwd: z.string().optional().describe("Working directory"),
              command: z
                .string()
                .optional()
                .describe('Shell command (required for "custom" agent)'),
              env: z
                .record(z.string())
                .optional()
                .describe("Additional environment variables"),
            }),
          )
          .describe("Array of tasks to dispatch"),
      },
    },
    async ({ tasks }: { tasks: Array<SpawnOptions & { task: string }> }) => {
      for (const t of tasks) {
        if (t.agent === "custom" && !t.command) {
          return errorResult(
            `task "${t.name}": agent "custom" requires a command parameter`,
          );
        }
      }
      return forward(bridge, "dispatch_tasks", { tasks });
    },
  );
}
