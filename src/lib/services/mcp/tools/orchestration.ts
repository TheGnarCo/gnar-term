/**
 * Orchestration tools: dispatch_tasks.
 */
import { registerTool, getTools } from "../registry";
import type { AgentType } from "../types";

registerTool({
  name: "dispatch_tasks",
  description:
    "Spawn multiple agent sessions in parallel. Each task resolves its target independently — pass workspace_id/pane_id per task to override the connection binding.",
  inputSchema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            agent: { type: "string" },
            task: { type: "string" },
            cwd: { type: "string" },
            command: { type: "string" },
            workspace_id: { type: "string" },
            pane_id: { type: "string" },
          },
          required: ["name", "agent", "task"],
        },
      },
    },
    required: ["tasks"],
  },
  handler: async (args, ctx) => {
    const { tasks } = args as {
      tasks: Array<{
        name: string;
        agent: AgentType;
        task: string;
        cwd?: string;
        command?: string;
        workspace_id?: string;
        pane_id?: string;
      }>;
    };
    const results: Array<{
      session_id: string;
      name: string;
      agent: AgentType;
      pid: number | undefined;
      pane_id?: string;
      workspace_id?: string;
      error?: string;
    }> = [];
    const spawnTool = getTools().find((t) => t.name === "spawn_agent")!;
    for (const taskDef of tasks) {
      try {
        const resp = (await spawnTool.handler(
          {
            name: taskDef.name,
            agent: taskDef.agent,
            task: taskDef.task,
            cwd: taskDef.cwd,
            command: taskDef.command,
            workspace_id: taskDef.workspace_id,
            pane_id: taskDef.pane_id,
          },
          ctx,
        )) as {
          session_id: string;
          name: string;
          agent: AgentType;
          pid: number | undefined;
          pane_id: string;
          workspace_id: string;
        };
        results.push({
          session_id: resp.session_id,
          name: resp.name,
          agent: resp.agent,
          pid: resp.pid,
          pane_id: resp.pane_id,
          workspace_id: resp.workspace_id,
        });
      } catch (err) {
        results.push({
          session_id: "",
          name: taskDef.name,
          agent: taskDef.agent,
          pid: undefined,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      dispatched: results.filter((r) => !r.error).length,
      failed: results.filter((r) => r.error).length,
      sessions: results,
    };
  },
});
