/**
 * Agentic Core MCP tools — cycle-7.
 *
 * Registers three tools that expose the agentic-core-refresh substrate
 * (cycles 1-6) over MCP:
 *
 *   spawn_branch   — Create a Worktree Branch and optionally auto-spawn an agent.
 *   emit_attention — Push a typed attention event into the Attention API.
 *   get_pane_agent — Return agentType + agentState + intendedAgent for a pane.
 */
import { get } from "svelte/store";
import type { AgentType } from "../agent-type";
import type { AgentState } from "../agent-state";
import {
  paneAgentTypeStore,
  paneAgentStateStore,
} from "../agent-detection-service";
import {
  pushExternalAttention,
  type AttentionEventKind,
} from "../attention-api";
import {
  spawnAgentInWorktree,
  resolveAgentPresetForSpawn,
  deriveWorktreePath,
  type ResolvedAgentPreset,
} from "../spawn-helper";
import { paneExists, lookupPaneIntendedAgent } from "../pane-lookup";
import { createWorktreeWorkspaceFromConfig } from "../worktree-service";
import type { ToolDef } from "../mcp-types";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const agenticCoreTools: ToolDef[] = [
  // ---- spawn_branch --------------------------------------------------------
  {
    name: "spawn_branch",
    description:
      "Create a Worktree Branch via the worktree-service and optionally auto-spawn an AI coding agent inside it. When `agent` is omitted, just creates the branch workspace. Returns branchId, worktreePath, and agentSpawned.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the new Branch workspace.",
        },
        base: {
          type: "string",
          description:
            "Base branch to create the worktree from. Default: main.",
        },
        repoPath: {
          type: "string",
          description:
            "Absolute path to the source repo. Required when there is no workspace context to derive it from.",
        },
        agent: {
          type: "object",
          description:
            "When provided, spawn an AI coding agent inside the new Branch after creation. Wins over agent_preset_name when both are passed.",
          properties: {
            type: {
              type: "string",
              enum: ["claude-code", "codex", "aider", "custom"],
              description: "Agent type to spawn.",
            },
            command: {
              type: "string",
              description:
                "Literal command for agent type 'custom'. Required when type is 'custom'.",
            },
            initialPrompt: {
              type: "string",
              description:
                "Optional task context prepended to the agent's startup command.",
            },
          },
          required: ["type"],
        },
        agent_preset_name: {
          type: "string",
          description:
            "Name of an AgentPreset from settings.json `agents[]`. Resolves to agent type + command + initialPrompt + env. Ignored when `agent` is provided.",
        },
      },
      required: ["name"],
    },
    handler: async (args) => {
      const p = args as {
        name: string;
        base?: string;
        repoPath?: string;
        agent?: {
          type: "claude-code" | "codex" | "aider" | "custom";
          command?: string;
          initialPrompt?: string;
        };
        agent_preset_name?: string;
      };

      if (!p.name || !p.name.trim()) {
        throw new Error("spawn_branch: name is required");
      }

      const branch = p.name.trim().replace(/\s+/g, "-");
      const base = p.base?.trim() || "main";

      // Explicit agent arg wins over preset. Otherwise fall back to preset
      // resolution; either source produces the same downstream call.
      const resolved: ResolvedAgentPreset | null = p.agent
        ? {
            type: p.agent.type,
            command: p.agent.command ?? "",
            ...(p.agent.initialPrompt !== undefined
              ? { taskContext: p.agent.initialPrompt }
              : {}),
          }
        : p.agent_preset_name
          ? resolveAgentPresetForSpawn(p.agent_preset_name)
          : null;

      if (resolved) {
        if (!p.repoPath || !p.repoPath.trim()) {
          throw new Error(
            "spawn_branch: repoPath is required when spawning an agent (no workspace context to derive it from)",
          );
        }

        const result = await spawnAgentInWorktree({
          name: p.name.trim(),
          agent: resolved.type,
          ...(p.agent
            ? p.agent.command !== undefined
              ? { command: p.agent.command }
              : {}
            : { command: resolved.command }),
          ...(resolved.taskContext !== undefined
            ? { taskContext: resolved.taskContext }
            : {}),
          ...(resolved.env ? { env: resolved.env } : {}),
          repoPath: p.repoPath.trim(),
          branch,
          base,
        });

        return {
          branchId: result.branch,
          worktreePath: result.worktree_path,
          agentSpawned: true,
        };
      }

      // No agent: create the branch workspace only.
      if (!p.repoPath || !p.repoPath.trim()) {
        throw new Error(
          "spawn_branch: repoPath is required (no workspace context to derive it from)",
        );
      }

      const worktreePath = deriveWorktreePath(p.repoPath.trim(), branch);
      await createWorktreeWorkspaceFromConfig({
        repoPath: p.repoPath.trim(),
        branch,
        base,
        worktreePath,
        controlled: true,
      });

      return {
        branchId: branch,
        worktreePath,
        agentSpawned: false,
      };
    },
  },

  // ---- emit_attention -------------------------------------------------------
  {
    name: "emit_attention",
    description:
      "Push a typed attention event into the Attention API for a given pane. The event appears in attentionStore and may trigger UI indicators (hats, badges). The pane does not need to be currently running an agent.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: {
          type: "string",
          description: "Id of the pane to emit the event for.",
        },
        kind: {
          type: "string",
          enum: [
            "awaiting_input",
            "errored",
            "completed",
            "notify",
            "progress",
          ],
          description: "Attention event kind.",
        },
        title: { type: "string", description: "Optional short title." },
        body: {
          type: "string",
          description: "Optional longer description or context.",
        },
        level: {
          type: "string",
          description:
            "Optional severity level (e.g. 'info', 'warning', 'error').",
        },
      },
      required: ["paneId", "kind"],
    },
    handler: (args) => {
      const p = args as {
        paneId?: string;
        kind?: string;
        title?: string;
        body?: string;
        level?: string;
      };

      if (!p.paneId || !p.paneId.trim()) {
        throw new Error("emit_attention: paneId is required");
      }
      if (!p.kind) {
        throw new Error("emit_attention: kind is required");
      }
      const trimmedPaneId = p.paneId.trim();
      if (!paneExists(trimmedPaneId)) {
        throw new Error(
          `emit_attention: paneId "${trimmedPaneId}" does not match any known pane`,
        );
      }

      const VALID_KINDS = new Set<string>([
        "awaiting_input",
        "errored",
        "completed",
        "notify",
        "progress",
      ]);
      if (!VALID_KINDS.has(p.kind)) {
        throw new Error(
          `emit_attention: invalid kind "${p.kind}". Valid values: ${[...VALID_KINDS].join(", ")}`,
        );
      }

      const eventId = `ext-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      pushExternalAttention({
        paneId: trimmedPaneId,
        kind: p.kind as AttentionEventKind,
        title: p.title,
        body: p.body,
        level: p.level,
      });

      return { ok: true as const, eventId };
    },
  },

  // ---- get_pane_agent -------------------------------------------------------
  {
    name: "get_pane_agent",
    description:
      "Return the detected agent type, current agent state, and intended-agent hint for a pane. Reads paneAgentTypeStore (cycle-1), paneAgentStateStore (cycle-4), and the workspace pane's intendedAgent property (cycle-5). Returns agentState 'unknown' for panes with no detection yet.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: {
          type: "string",
          description: "Id of the pane to query.",
        },
      },
      required: ["paneId"],
    },
    handler: (args) => {
      const p = args as { paneId?: string };

      if (!p.paneId || !p.paneId.trim()) {
        throw new Error("get_pane_agent: paneId is required");
      }

      const paneId = p.paneId.trim();

      if (!paneExists(paneId)) {
        throw new Error(
          `get_pane_agent: pane "${paneId}" not found (it may have been closed)`,
        );
      }

      // Read paneAgentTypeStore — entry may be absent if no agent detected.
      const typeEntry = get(paneAgentTypeStore)[paneId];
      const agentType: AgentType | undefined = typeEntry?.agentType;

      // Read paneAgentStateStore — defaults to "unknown" if absent.
      const stateEntry = get(paneAgentStateStore).get(paneId);
      const agentState: AgentState = stateEntry?.state ?? "unknown";

      // Read intendedAgent from the Pane definition in the workspaces store.
      const intendedAgent = lookupPaneIntendedAgent(paneId) ?? undefined;

      const result: {
        paneId: string;
        agentType?: AgentType;
        agentState: AgentState;
        intendedAgent?: AgentType;
      } = { paneId, agentState };

      if (agentType !== undefined) result.agentType = agentType;
      if (intendedAgent !== undefined) result.intendedAgent = intendedAgent;

      return result;
    },
  },
];
