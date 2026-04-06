import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionStore } from "../session-store.js";
import type { PtyManager } from "../pty-manager.js";
import { AGENT_COMMANDS } from "../types.js";
import type { SpawnOptions } from "../types.js";

export function registerOrchestrationTools(
  server: McpServer,
  sessions: SessionStore,
  ptyManager: PtyManager,
): void {
  server.registerTool(
    "dispatch_tasks",
    {
      description:
        "Spawn multiple agent sessions in parallel, each with its own task. Returns all session IDs for subsequent monitoring.",
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
          .describe("Array of agent tasks to dispatch"),
      },
    },
    async ({ tasks }: { tasks: Array<SpawnOptions & { task: string }> }) => {
      const results: Array<{
        session_id: string;
        name: string;
        agent: string;
        pid: number | undefined;
        error?: string;
      }> = [];

      for (const taskDef of tasks) {
        const opts: SpawnOptions = {
          name: taskDef.name,
          agent: taskDef.agent,
          task: taskDef.task,
          cwd: taskDef.cwd,
          command: taskDef.command,
          env: taskDef.env,
        };

        let commandStr: string;
        if (opts.agent === "custom") {
          if (!opts.command) {
            results.push({
              session_id: "",
              name: opts.name,
              agent: opts.agent,
              pid: undefined,
              error: 'agent "custom" requires a command parameter',
            });
            continue;
          }
          commandStr = opts.command;
        } else {
          commandStr = AGENT_COMMANDS[opts.agent].join(" ");
        }

        const session = sessions.create(opts, commandStr);
        try {
          const { pid } = ptyManager.spawn(
            session.id,
            opts,
            (status, exitCode) => {
              sessions.updateStatus(session.id, status, exitCode);
            },
          );
          sessions.updatePid(session.id, pid);
          results.push({
            session_id: session.id,
            name: session.name,
            agent: session.agentType,
            pid,
          });
        } catch (err) {
          sessions.delete(session.id);
          results.push({
            session_id: "",
            name: opts.name,
            agent: opts.agent,
            pid: undefined,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                dispatched: results.filter((r) => !r.error).length,
                failed: results.filter((r) => r.error).length,
                sessions: results,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
