import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionStore } from "../session-store.js";
import type { PtyManager } from "../pty-manager.js";
import { AGENT_COMMANDS } from "../types.js";
import type { SpawnOptions, SessionPlacement } from "../types.js";

const agentSchema = z.enum(["claude-code", "codex", "aider", "custom"]).describe("Agent CLI to launch");

function spawnSession(
  opts: SpawnOptions,
  sessions: SessionStore,
  ptyManager: PtyManager,
  placement: SessionPlacement,
) {
  let commandStr: string;
  if (opts.agent === "custom") {
    if (!opts.command) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: 'agent "custom" requires a command parameter' }) }],
        isError: true,
      };
    }
    commandStr = opts.command;
  } else {
    commandStr = AGENT_COMMANDS[opts.agent].join(" ");
  }

  // Create session silently — we emit our own placement event instead
  const session = sessions.create(opts, commandStr, { silent: true });
  try {
    const { pid } = ptyManager.spawn(session.id, opts, (status, exitCode) => {
      sessions.updateStatus(session.id, status, exitCode);
    });
    sessions.updatePid(session.id, pid);

    // Emit placement event so the bridge/frontend knows WHERE to put this session
    sessions.emit("session-placed", { session, placement });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          session_id: session.id,
          name: session.name,
          pid: session.pid,
          placement,
        }, null, 2),
      }],
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    sessions.delete(session.id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: errMsg }) }],
      isError: true,
    };
  }
}

export function registerPaneTools(
  server: McpServer,
  sessions: SessionStore,
  ptyManager: PtyManager,
): void {
  server.registerTool(
    "create_tab",
    {
      description:
        "Create a new terminal tab in the active pane. " +
        "The session appears as a new tab alongside existing terminals.",
      inputSchema: {
        agent: agentSchema,
        command: z.string().optional().describe('Shell command (required for "custom" agent)'),
        name: z.string().describe("Tab label"),
        task: z.string().optional().describe("Initial prompt to send after agent starts"),
        cwd: z.string().optional().describe("Working directory"),
        env: z.record(z.string()).optional().describe("Additional environment variables"),
      },
    },
    async ({ agent, command, name, task, cwd, env }) => {
      return spawnSession(
        { agent, command, name, task, cwd, env },
        sessions, ptyManager, "tab",
      );
    },
  );

  server.registerTool(
    "create_pane",
    {
      description:
        "Create a new split pane in the active workspace. " +
        "Splits the current pane either horizontally (right) or vertically (down).",
      inputSchema: {
        agent: agentSchema,
        command: z.string().optional().describe('Shell command (required for "custom" agent)'),
        name: z.string().describe("Pane label"),
        direction: z.enum(["right", "down"]).default("right").describe("Split direction: right or down (default: right)"),
        task: z.string().optional().describe("Initial prompt to send after agent starts"),
        cwd: z.string().optional().describe("Working directory"),
        env: z.record(z.string()).optional().describe("Additional environment variables"),
      },
    },
    async ({ agent, command, name, direction, task, cwd, env }) => {
      const placement: SessionPlacement = direction === "down" ? "split-down" : "split-right";
      return spawnSession(
        { agent, command, name, task, cwd, env },
        sessions, ptyManager, placement,
      );
    },
  );
}
