/**
 * Agentic Orchestrator — dashboard / widget / spawn UI for the
 * orchestrator-first workflow.
 *
 * Passive detection (title/output pattern matching, status tracking,
 * agent registry, workspace indicators, per-surface tab dots) lives in
 * core — see src/lib/services/agent-detection-service.ts. The
 * extension consumes that via `api.agents`.
 *
 * What this extension owns:
 *   - AgentOrchestrator entity (orchestrator-service.ts) + New
 *     Orchestrator workspace action
 *   - Global Agents secondary sidebar tab
 *   - Markdown widgets (Kanban / Issues / AgentList / AgentStatusRow /
 *     Columns / TaskSpawner) registered via registerMarkdownComponent
 *   - Child-row contributor that nests orchestrators under projects
 *
 * Each orchestrator owns a Dashboard workspace (see
 * orchestrator-service.createOrchestrator) created eagerly with the
 * orchestrator and destroyed alongside it.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import { resolveProjectColor } from "../api";
import { get } from "svelte/store";
import {
  loadOrchestrators,
  orchestratorsStore,
  getOrchestrators,
  createOrchestrator,
  openOrchestratorDashboard,
  ensureOrchestratorDashboards,
  writeOrchestratorDashboardTemplate,
  ORCHESTRATOR_WORKSPACE_META_KEY,
  DASHBOARD_METADATA_KEY,
} from "./orchestrator-service";
import AgentOrchestratorRow from "./AgentOrchestratorRow.svelte";
import Kanban from "./components/Kanban.svelte";
import Issues from "./components/Issues.svelte";
import AgentList from "./components/AgentList.svelte";
import AgentListSidebarTab from "./components/AgentListSidebarTab.svelte";
import AgentStatusRow from "./components/AgentStatusRow.svelte";
import TaskSpawner from "./components/TaskSpawner.svelte";
import Columns from "./components/Columns.svelte";

const ROOT_ROW_KIND = "agent-orchestrator";

// --- Manifest ---

export const agenticOrchestratorManifest: ExtensionManifest = {
  id: "agentic-orchestrator",
  name: "Agentic Orchestrator",
  version: "0.4.0",
  description:
    "Orchestrators, Dashboards, widgets, and spawn UI for parallel AI agents. Consumes core's passive detection via api.agents.",
  entry: "./index.ts",
  included: true,
  permissions: [],
  contributes: {
    workspaceActions: [
      {
        id: "new-orchestrator",
        title: "New Agent Orchestrator",
        icon: "layout-dashboard",
      },
    ],
    secondarySidebarTabs: [{ id: "agents", label: "Agents", icon: "users" }],
    events: ["workspace:created", "workspace:closed"],
  },
};

// --- Registration ---

export function registerAgenticOrchestratorExtension(api: ExtensionAPI): void {
  const eventCleanups: Array<() => void> = [];

  const publishedOrchestratorIds = new Set<string>();
  let orchestratorUnsub: (() => void) | null = null;

  api.onActivate(() => {
    loadOrchestrators();

    // Ensure each orchestrator has a Dashboard workspace (post-load
    // reconciliation). Fires asynchronously; UI handles missing workspaces
    // gracefully until it completes.
    void ensureOrchestratorDashboards();

    api.registerWorkspaceAction("new-orchestrator", {
      label: "New Agent Orchestrator",
      icon: "layout-dashboard",
      handler: (ctx) => newOrchestratorFlow(api, ctx),
    });

    api.registerSecondarySidebarTab("agents", AgentListSidebarTab);

    api.registerRootRowRenderer(ROOT_ROW_KIND, AgentOrchestratorRow, {
      railColor: (rowId: string) => {
        const o = getOrchestrators().find((orch) => orch.id === rowId);
        if (!o) return undefined;
        return resolveProjectColor(o.color, get(api.theme));
      },
      label: (rowId: string) =>
        getOrchestrators().find((orch) => orch.id === rowId)?.name,
    });

    api.registerMarkdownComponent("kanban", Kanban, {
      configSchema: {
        type: "object",
        properties: {
          orchestratorId: {
            type: "string",
            description: "Optional orchestrator scope. Omit for global view.",
          },
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
          orchestratorId: { type: "string" },
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
          orchestratorId: { type: "string" },
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
          orchestratorId: { type: "string", description: "Required scope." },
          defaultAgent: { type: "string", default: "claude-code" },
        },
        required: ["orchestratorId"],
      },
    });

    // Nested orchestrators no longer contribute a separate row under
    // projects — their Dashboard workspace is claimed by project-scope
    // (via metadata.projectId on the Dashboard) and renders as an
    // agentic Dashboard tile inside the project's nested list. Spawned
    // worktrees similarly bubble up via their metadata.projectId.

    orchestratorUnsub = orchestratorsStore.subscribe((orchestrators) => {
      const rootIds = new Set(
        orchestrators.filter((o) => !o.parentProjectId).map((o) => o.id),
      );
      for (const id of rootIds) {
        if (!publishedOrchestratorIds.has(id)) {
          api.appendRootRow({ kind: ROOT_ROW_KIND, id });
          publishedOrchestratorIds.add(id);
        }
      }
      for (const id of [...publishedOrchestratorIds]) {
        if (!rootIds.has(id)) {
          api.removeRootRow({ kind: ROOT_ROW_KIND, id });
          publishedOrchestratorIds.delete(id);
        }
      }
    });

    // Workspaces that belong to an orchestrator — either as spawned worktrees
    // (metadata.parentOrchestratorId) or as the Dashboard workspace itself
    // (metadata.orchestratorId + metadata.isDashboard) — render nested under
    // their orchestrator in the sidebar. Claim them so they don't ALSO
    // appear at root.
    function isOrchestratorOwned(
      metadata: Record<string, unknown> | undefined,
    ): boolean {
      if (!metadata) return false;
      return (
        typeof metadata.parentOrchestratorId === "string" ||
        typeof metadata[ORCHESTRATOR_WORKSPACE_META_KEY] === "string"
      );
    }

    const handleWorkspaceCreated = (event: {
      type: string;
      id?: string;
      metadata?: unknown;
    }) => {
      const workspaceId = event.id;
      if (!workspaceId) return;
      if (isOrchestratorOwned(event.metadata as Record<string, unknown>)) {
        api.claimWorkspace(workspaceId);
      }
    };
    api.on("workspace:created", handleWorkspaceCreated);
    eventCleanups.push(() =>
      api.off("workspace:created", handleWorkspaceCreated),
    );

    const handleWorkspaceClosed = (event: { type: string; id?: string }) => {
      const workspaceId = event.id;
      if (!workspaceId) return;
      api.unclaimWorkspace(workspaceId);
    };
    api.on("workspace:closed", handleWorkspaceClosed);
    eventCleanups.push(() =>
      api.off("workspace:closed", handleWorkspaceClosed),
    );

    // Catch workspaces that were already open when the extension activated
    // (e.g. restored-from-session). Without this, pre-existing
    // orchestrator-owned workspaces appear at root until the user closes and
    // reopens them.
    const unsubInitialScan = api.workspaces.subscribe((list) => {
      for (const ws of list) {
        if (isOrchestratorOwned(ws.metadata as Record<string, unknown>)) {
          api.claimWorkspace(ws.id);
        }
      }
    });
    unsubInitialScan();
  });

  api.onDeactivate(() => {
    for (const cleanup of eventCleanups) cleanup();
    eventCleanups.length = 0;

    if (orchestratorUnsub) {
      orchestratorUnsub();
      orchestratorUnsub = null;
    }
    for (const id of publishedOrchestratorIds) {
      api.removeRootRow({ kind: ROOT_ROW_KIND, id });
    }
    publishedOrchestratorIds.clear();
  });
}

// Re-export the metadata keys so other modules consuming the extension's
// module can read them without importing the service directly.
export { ORCHESTRATOR_WORKSPACE_META_KEY, DASHBOARD_METADATA_KEY };

// --- Internal helpers ---

/**
 * Workspace action handler for `new-orchestrator`. Two modes:
 *
 *   - **Project context** (`ctx.projectPath` set): baseDir + color
 *     inherited from the project and locked. The dialog only asks for a
 *     name — both derived fields stay off-screen so the user can't drift
 *     an orchestrator's scope away from its host project.
 *   - **Root context** (no project): the dialog asks for baseDir
 *     (required, with Browse), name, and color.
 *
 * Writes the templated markdown only when the file does not already
 * exist — re-creating at the same path preserves the user's edits.
 *
 * Activation flow: `createOrchestrator` already creates the Dashboard
 * workspace and switches to it (workspace auto-switches on create). We
 * don't need to call `openOrchestratorDashboard` explicitly.
 */
async function newOrchestratorFlow(
  api: ExtensionAPI,
  ctx: Record<string, unknown>,
): Promise<void> {
  const projectId =
    typeof ctx.projectId === "string" ? ctx.projectId : undefined;
  const projectPath =
    typeof ctx.projectPath === "string" ? ctx.projectPath : undefined;
  const projectColor =
    typeof ctx.projectColor === "string" ? ctx.projectColor : undefined;

  const fields = projectPath
    ? [
        {
          key: "name" as const,
          label: "Name",
          defaultValue: "Agent Orchestrator",
          placeholder: "Agent Orchestrator",
        },
      ]
    : [
        {
          key: "baseDir" as const,
          label: "Base directory",
          type: "directory" as const,
          required: true,
          defaultValue: "",
          pickerTitle: "Select orchestrator base directory",
          placeholder: "Pick a folder...",
        },
        {
          key: "name" as const,
          label: "Name",
          defaultValue: "Agent Orchestrator",
          placeholder: "Agent Orchestrator",
        },
        {
          key: "color" as const,
          label: "Color",
          type: "color" as const,
          defaultValue: "purple",
        },
      ];

  const result = await api.showFormPrompt("New Agent Orchestrator", fields, {
    submitLabel: "Create",
  });
  if (!result) return;

  const baseDir = (projectPath ?? result.baseDir ?? "").trim();
  if (!baseDir) return;
  const name = (result.name ?? "").trim();
  if (!name) return;
  const color = projectColor ?? (result.color || "purple");

  const orchestrator = await createOrchestrator({
    name,
    baseDir,
    color,
    ...(projectId ? { parentProjectId: projectId } : {}),
  });

  try {
    await writeOrchestratorDashboardTemplate(orchestrator);
  } catch (err) {
    api.reportError(`Failed to write orchestrator markdown: ${err}`);
  }

  // createOrchestrator auto-switches to the new Dashboard workspace via
  // createWorkspaceFromDef; this call is a no-op when the switch already
  // happened, but keeps the "opening an orchestrator brings its Dashboard
  // forward" contract explicit.
  openOrchestratorDashboard(orchestrator);
}
