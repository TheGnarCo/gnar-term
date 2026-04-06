import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionStore } from "../session-store.js";
import type { PtyManager } from "../pty-manager.js";
import { AGENT_COMMANDS } from "../types.js";
import type {
  SpawnOptions,
  ScreenLayoutSpec,
  ScreenLayoutResolved,
  ScreenDescriptor,
  AgentSession,
} from "../types.js";

// --- Zod schema for recursive layout ---

const screenPaneSchema = z.object({
  agent: z.enum(["claude-code", "codex", "aider", "custom"]).describe("Agent CLI to launch"),
  command: z.string().optional().describe('Shell command (required for "custom" agent)'),
  name: z.string().describe("Pane label"),
  task: z.string().optional().describe("Initial prompt to send after agent starts"),
  cwd: z.string().optional().describe("Working directory"),
  env: z.record(z.string()).optional().describe("Additional environment variables"),
});

const screenLayoutSchema: z.ZodType<ScreenLayoutSpec> = z.lazy(() =>
  z.union([
    screenPaneSchema,
    z.object({
      direction: z.enum(["horizontal", "vertical"]).describe("Split direction"),
      ratio: z.number().min(0.1).max(0.9).optional().describe("Split ratio (default 0.5)"),
      children: z.tuple([screenLayoutSchema, screenLayoutSchema]).describe("Two child nodes"),
    }),
  ]),
);

// --- Helper: check if a layout node is a pane (leaf) ---

function isPane(node: ScreenLayoutSpec): node is Extract<ScreenLayoutSpec, { agent: string }> {
  return "agent" in node;
}

// --- Recursive spawner ---

async function spawnLayout(
  node: ScreenLayoutSpec,
  sessions: SessionStore,
  ptyManager: PtyManager,
): Promise<{ resolved: ScreenLayoutResolved; spawned: AgentSession[]; errors: string[] }> {
  if (isPane(node)) {
    const opts: SpawnOptions = {
      name: node.name,
      agent: node.agent,
      task: node.task,
      cwd: node.cwd,
      command: node.command,
      env: node.env,
    };

    let commandStr: string;
    if (opts.agent === "custom") {
      if (!opts.command) {
        return {
          resolved: {
            session: { id: "", name: node.name, agentType: node.agent, command: "", status: "exited", cwd: "", pid: undefined, createdAt: new Date().toISOString(), exitCode: 1 },
            error: 'agent "custom" requires a command parameter',
          },
          spawned: [],
          errors: [`${node.name}: agent "custom" requires a command parameter`],
        };
      }
      commandStr = opts.command;
    } else {
      commandStr = AGENT_COMMANDS[opts.agent].join(" ");
    }

    const session = sessions.create(opts, commandStr, { silent: true });
    try {
      const { pid } = ptyManager.spawn(session.id, opts, (status, exitCode) => {
        sessions.updateStatus(session.id, status, exitCode);
      });
      sessions.updatePid(session.id, pid);
      return {
        resolved: { session },
        spawned: [session],
        errors: [],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      sessions.delete(session.id);
      return {
        resolved: {
          session: { ...session, status: "exited", exitCode: 1 },
          error: errMsg,
        },
        spawned: [],
        errors: [`${node.name}: ${errMsg}`],
      };
    }
  }

  // Branch node: recurse both children
  const [left, right] = await Promise.all([
    spawnLayout(node.children[0], sessions, ptyManager),
    spawnLayout(node.children[1], sessions, ptyManager),
  ]);

  return {
    resolved: {
      direction: node.direction,
      ratio: node.ratio ?? 0.5,
      children: [left.resolved, right.resolved],
    },
    spawned: [...left.spawned, ...right.spawned],
    errors: [...left.errors, ...right.errors],
  };
}

// --- Tool registration ---

export function registerScreenTools(
  server: McpServer,
  sessions: SessionStore,
  ptyManager: PtyManager,
): void {
  server.registerTool(
    "create_screen",
    {
      description:
        "Create a split-pane screen/dashboard with multiple agent sessions arranged in a layout. " +
        "Each leaf in the layout tree becomes a terminal pane. The screen appears as a new workspace in Gnar Term.",
      inputSchema: {
        name: z.string().describe("Screen name (appears as workspace tab)"),
        layout: screenLayoutSchema.describe("Recursive layout tree — leaves are panes, branches are splits"),
      },
    },
    async ({ name, layout }: { name: string; layout: ScreenLayoutSpec }) => {
      const { resolved, spawned, errors } = await spawnLayout(layout, sessions, ptyManager);

      if (spawned.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "All sessions failed to spawn", details: errors }, null, 2),
          }],
          isError: true,
        };
      }

      const screen: ScreenDescriptor = { name, layout: resolved };
      sessions.emit("screen-created", screen);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            screen_name: name,
            total_panes: spawned.length + errors.length,
            spawned: spawned.length,
            failed: errors.length,
            sessions: spawned.map(s => ({ session_id: s.id, name: s.name, pid: s.pid })),
            errors: errors.length > 0 ? errors : undefined,
          }, null, 2),
        }],
      };
    },
  );
}
