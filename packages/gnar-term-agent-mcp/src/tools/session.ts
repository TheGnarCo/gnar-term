import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionStore } from "../session-store.js";
import type { PtyManager } from "../pty-manager.js";
import { AGENT_COMMANDS } from "../types.js";
import type { SpawnOptions } from "../types.js";

export function registerSessionTools(
  server: McpServer,
  sessions: SessionStore,
  ptyManager: PtyManager,
): void {
  server.registerTool(
    "spawn_agent",
    {
      description:
        "Start an AI coding agent CLI in a managed terminal session. Returns session ID for subsequent interaction.",
      inputSchema: {
        name: z.string().describe("Human-readable session label"),
        agent: z
          .enum(["claude-code", "codex", "aider", "custom"])
          .describe("Agent CLI to launch"),
        task: z
          .string()
          .optional()
          .describe(
            "Initial prompt to send after agent starts (delivered after 3s startup delay)",
          ),
        cwd: z.string().optional().describe("Working directory for the session"),
        command: z
          .string()
          .optional()
          .describe('Shell command to run (required when agent is "custom")'),
        env: z
          .record(z.string())
          .optional()
          .describe("Additional environment variables"),
        cols: z.number().optional().describe("Terminal columns (default 120)"),
        rows: z.number().optional().describe("Terminal rows (default 30)"),
      },
    },
    async (args) => {
      const opts = args as unknown as SpawnOptions;
      // Resolve the command string for metadata
      let commandStr: string;
      if (opts.agent === "custom") {
        if (!opts.command)
          return {
            content: [
              {
                type: "text" as const,
                text: 'Error: agent "custom" requires a command parameter',
              },
            ],
            isError: true,
          };
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
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  session_id: session.id,
                  name: session.name,
                  agent: session.agentType,
                  pid,
                  status: "starting",
                  cwd: session.cwd,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        sessions.delete(session.id);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error spawning agent: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_sessions",
    {
      description:
        "List all active agent sessions with their current status, PID, and working directory.",
    },
    async () => {
      const all = sessions.list();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(all, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_session_info",
    {
      description:
        "Get detailed information about a specific agent session including output buffer stats.",
      inputSchema: {
        session_id: z.string().describe("Session ID returned by spawn_agent"),
      },
    },
    async ({ session_id }: { session_id: string }) => {
      const session = sessions.get(session_id);
      if (!session) {
        return {
          content: [
            { type: "text" as const, text: `Error: session ${session_id} not found` },
          ],
          isError: true,
        };
      }
      const buffer = ptyManager.getBuffer(session_id);
      const bufferStats = buffer
        ? {
            cursor: buffer.getCursor(),
            lastLine: buffer.getLastLine(),
          }
        : null;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ...session, bufferStats }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "kill_session",
    {
      description:
        "Terminate an agent session. Sends the specified signal to the process.",
      inputSchema: {
        session_id: z.string().describe("Session ID to terminate"),
        signal: z
          .string()
          .optional()
          .describe("Signal to send (default: SIGTERM)"),
      },
    },
    async ({ session_id, signal }: { session_id: string; signal?: string }) => {
      const session = sessions.get(session_id);
      if (!session) {
        return {
          content: [
            { type: "text" as const, text: `Error: session ${session_id} not found` },
          ],
          isError: true,
        };
      }
      try {
        ptyManager.kill(session_id, signal);
        return {
          content: [
            {
              type: "text" as const,
              text: `Session ${session.name} (${session_id}) terminated with ${signal ?? "SIGTERM"}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error killing session: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
