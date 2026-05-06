/**
 * Agentic Orchestrator — registers the Agentic Dashboard contribution
 * (per-workspace, capPerWorkspace=1) and the Global Agentic Dashboard
 * pseudo-workspace, plus the markdown widgets they embed (kanban,
 * agent-list, task-spawner, issues, agent-status-row, columns).
 *
 * Passive detection lives in core (src/lib/services/agent-detection-service.ts);
 * this extension consumes agents via `api.agents`. Stage 7 collapsed the
 * previous AgentOrchestrator entity into a dashboard contribution — no
 * standalone root-level orchestrator row, no orchestrator CRUD. Widgets
 * pull their scope from the enclosing DashboardHostContext (spec §5.3);
 * this extension provides two such hosts:
 *   1. A dashboard child workspace materialized by the `agentic` contribution
 *      on a workspace (`metadata.rootWorkspaceId` → workspace scope).
 *   2. The `agentic.global` pseudo-workspace (synthetic metadata with
 *      `isGlobalAgenticDashboard: true` → global scope).
 */
import type { ExtensionManifest, ExtensionAPI, WorkspaceRef } from "../api";
import BotIcon from "./icons/BotIcon.svelte";
import GlobalAgenticDashboardBody from "./components/GlobalAgenticDashboardBody.svelte";
import AgentStatusGrid from "./components/AgentStatusGrid.svelte";
import Kanban from "./components/Kanban.svelte";
import Issues from "./components/Issues.svelte";
import Prs from "./components/Prs.svelte";
import AgentList from "./components/AgentList.svelte";
import AgentStatusRow from "./components/AgentStatusRow.svelte";
import TaskSpawner from "./components/TaskSpawner.svelte";
import Columns from "./components/Columns.svelte";

// --- Manifest ---

export const agenticOrchestratorManifest: ExtensionManifest = {
  id: "agentic-orchestrator",
  name: "Agentic Orchestrator",
  version: "0.5.0",
  description:
    "Agentic Dashboard contribution (per-workspace, cap 1) + Global Agentic pseudo-workspace. Consumes core's passive detection via api.agents.",
  entry: "./index.ts",
  included: true,
  permissions: ["filesystem"],
  contributes: {
    settings: {
      fields: {
        globalAgentsMarkdownPath: {
          type: "string",
          title: "Global Agents markdown path",
          description:
            "Backing markdown file for the Global Agentic Dashboard pseudo-workspace. Leave blank to fall back to ~/.config/gnar-term/global-agents.md.",
          default: "",
        },
      },
    },
  },
};

// --- Registration ---

export function registerAgenticOrchestratorExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerDashboardContribution({
      id: "agentic",
      label: "Agentic Dashboard",
      actionLabel: "Add Agentic Dashboard",
      capPerWorkspace: 1,
      autoProvision: true,
      icon: BotIcon,
      lockedReason: "Required by Agentic extension",
      create: (workspace) => createAgenticDashboardWorkspace(api, workspace),
      regenerate: async (workspace) => {
        await writeAgenticDashboardTemplate(api, workspace, { force: true });
      },
    });

    // The Agentic Dashboard contribution is autoProvision: true, so
    // core's registerDashboardContribution wrapper handles the
    // post-restore back-fill onto every existing workspace. The
    // matching teardown on deactivate flows through the registry
    // cleanup pipeline (closeAutoDashboardsBySource), so neither hook
    // needs to be wired here.

    const CLOSED_KEY = "globalDashboardClosed";

    function registerReopenAction(): void {
      api.registerWorkspaceAction("reopen-global-dashboard", {
        label: "Agents Dashboard",
        zone: "workspace",
        handler: () => {
          void api.state.set(CLOSED_KEY, false);
          api.unregisterWorkspaceAction("reopen-global-dashboard");
          registerGlobalDashboard();
        },
      });
    }

    function registerGlobalDashboard(): void {
      api.registerPseudoWorkspace({
        id: "agentic.global",
        label: "Agents dashboard",
        position: "root-top",
        icon: BotIcon,
        render: GlobalAgenticDashboardBody,
        rowBody: AgentStatusGrid,
        metadata: { isGlobalAgenticDashboard: true },
        onClose() {
          void api.state.set(CLOSED_KEY, true);
          api.unregisterWorkspaceAction("reopen-global-dashboard");
          registerReopenAction();
        },
      });
    }

    const wasClosed = api.state.get<boolean>(CLOSED_KEY);
    if (wasClosed) {
      registerReopenAction();
    } else {
      registerGlobalDashboard();
    }

    api.registerMarkdownComponent("kanban", Kanban, {
      configSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Optional title override (default: 'Agents').",
          },
        },
      },
    });
    api.registerMarkdownComponent("issues", Issues, {
      configSchema: {
        type: "object",
        properties: {
          repoPath: {
            type: "string",
            description:
              "Required when the enclosing dashboard host is global; ignored under a workspace host (uses workspace.path instead).",
          },
          repo: {
            type: "string",
            description: "owner/name (defaults to gh inference).",
          },
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            default: "open",
          },
          limit: { type: "number", default: 25 },
          displayOnly: {
            type: "boolean",
            default: false,
            description:
              "When true, hide the per-row Spawn split-button. Used by the Workspace Overview Dashboard, where the issue list is a passive read-only browse panel.",
          },
        },
      },
    });
    api.registerMarkdownComponent("prs", Prs, {
      configSchema: {
        type: "object",
        properties: {
          repoPath: {
            type: "string",
            description:
              "Required when the enclosing dashboard host is global; ignored under a workspace host (uses workspace.path instead).",
          },
          repo: {
            type: "string",
            description: "owner/name (defaults to gh inference).",
          },
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            default: "open",
          },
          limit: { type: "number", default: 25 },
        },
      },
    });
    api.registerMarkdownComponent("agent-list", AgentList, {
      configSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
      },
    });
    api.registerMarkdownComponent("agent-status-row", AgentStatusRow, {
      configSchema: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Required agent id." },
        },
        required: ["agentId"],
      },
    });
    api.registerMarkdownComponent("columns", Columns, {
      configSchema: {
        type: "object",
        properties: {
          children: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                config: { type: "object" },
              },
              required: ["name"],
            },
          },
          gap: { type: "number", default: 16 },
          columns: { type: "string" },
        },
        required: ["children"],
      },
    });
    api.registerMarkdownComponent("task-spawner", TaskSpawner, {
      configSchema: {
        type: "object",
        properties: {
          repoPath: {
            type: "string",
            description:
              "Required when the enclosing dashboard host is global; ignored under a workspace host (uses workspace.path instead).",
          },
          defaultAgent: { type: "string", default: "claude-code" },
        },
      },
    });
  });

  // Auto-provisioned dashboards are torn down by the registry cleanup
  // pipeline on deactivate (closeAutoDashboardsBySource runs before
  // unregisterDashboardContributionsBySource), so no onDeactivate hook
  // is needed here.
}

// --- Internal helpers ---

/**
 * Path of the markdown file backing a workspace's Agentic Dashboard.
 * Colocated under the workspace's `.gnar-term/` directory so multi-machine
 * sync / checkout follows the workspace itself.
 */
function agenticDashboardMarkdownPath(workspace: WorkspaceRef): string {
  return `${workspace.path.replace(/\/+$/, "")}/.gnar-term/agentic-dashboard.md`;
}

/**
 * Default template for a fresh Agentic Dashboard. Widgets pull scope
 * from the enclosing DashboardHostContext, so no props are needed — the
 * host child workspace's `metadata.rootWorkspaceId` drives filtering + spawn target.
 *
 * The workspace-level Agentic Dashboard intentionally omits the `agent-list`
 * widget: the Kanban already enumerates agents in scope and the workspace's
 * child workspace list in the sidebar shows the same set of
 * agent-spawned rows with live status chips. A duplicate "Active Agents"
 * section crowds the workspace dashboard without adding signal. The Global
 * Agentic Dashboard still uses agent-list because it has no sidebar
 * counterpart.
 *
 * The `gnar:issues` block at the bottom mounts the same widget the
 * Workspace Overview Dashboard uses, but with the Spawn split-button
 * active so each open issue can be turned into a worktree child workspace
 * (claude-code default; caret menu offers codex / aider / custom).
 */
function agenticDashboardTemplate(workspace: WorkspaceRef): string {
  return `# ${workspace.name} Agents

Spawn and monitor agents working inside \`${workspace.path}\`.

\`\`\`gnar:kanban
\`\`\`

\`\`\`gnar:task-spawner
\`\`\`

## Open Issues

\`\`\`gnar:issues
state: open
\`\`\`
`;
}

/**
 * Materialize a workspace's Agentic Dashboard child workspace. Writes
 * the backing markdown if missing (user edits survive re-create at the
 * same path) and creates a single-preview-surface child workspace
 * tagged with the rootWorkspaceId + contribution id. Called by the
 * DashboardContributionRegistry when a user chooses "Add Agentic
 * Dashboard" on a workspace.
 */
/**
 * Write the Agentic Dashboard markdown template to its canonical path.
 * `force: true` overwrites any existing file — used by the
 * "Regenerate" action in Workspace Settings.
 */
async function writeAgenticDashboardTemplate(
  api: ExtensionAPI,
  workspace: WorkspaceRef,
  options: { force?: boolean } = {},
): Promise<string> {
  const markdownPath = agenticDashboardMarkdownPath(workspace);
  if (!options.force) {
    const exists = await api
      .invoke<boolean>("file_exists", { path: markdownPath })
      .catch(() => false);
    if (exists) return markdownPath;
  }
  const dir = markdownPath.replace(/\/[^/]+$/, "");
  await api.invoke("ensure_dir", { path: dir });
  await api.invoke("write_file", {
    path: markdownPath,
    content: agenticDashboardTemplate(workspace),
  });
  return markdownPath;
}

async function createAgenticDashboardWorkspace(
  api: ExtensionAPI,
  workspace: WorkspaceRef,
): Promise<string> {
  const markdownPath = await writeAgenticDashboardTemplate(api, workspace);
  return await api.createWorkspaceFromDef({
    name: "Agents",
    layout: {
      pane: {
        surfaces: [
          {
            type: "preview",
            path: markdownPath,
            name: "Agents",
            focus: true,
          },
        ],
      },
    },
    isDashboard: true,
    rootWorkspaceId: workspace.id,
    dashboardContributionId: "agentic",
  });
}
