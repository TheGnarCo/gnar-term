/**
 * Agentic Orchestrator — dashboard / widget / spawn UI for the
 * orchestrator-first workflow.
 *
 * Passive detection (title/output pattern matching, status tracking,
 * agent registry, workspace indicators, per-surface tab dots) lives in
 * core now — see src/lib/services/agent-detection-service.ts. The
 * extension consumes that via `api.agents`.
 *
 * What this extension owns:
 *   - AgentDashboard entity (dashboard-service.ts) + New Agent
 *     Dashboard workspace action
 *   - Global Agents secondary sidebar tab
 *   - Markdown widgets (Kanban / Issues / AgentList / AgentStatusRow /
 *     Columns / TaskSpawner) registered via registerMarkdownComponent
 *   - Child-row contributors that nest dashboards under projects and
 *     worktree workspaces under dashboards
 *   - Dashboard preview re-spawn on workspace:activated
 *
 * Detection-related listeners, pattern lists, trackers, and registry
 * code are intentionally absent — if you find yourself reaching for
 * them, use api.agents (a Readable<AgentRef[]>) or subscribe to the
 * core `agent:statusChanged` event instead.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import {
  loadDashboards,
  dashboardsStore,
  getDashboardsForProject,
  getDashboards,
  createDashboard,
  openDashboard,
  ensureDashboardSurface,
  writeDashboardTemplate,
  DASHBOARD_WORKSPACE_META_KEY,
} from "./dashboard-service";
import AgentDashboardRow from "./AgentDashboardRow.svelte";
import Kanban from "./components/Kanban.svelte";
import Issues from "./components/Issues.svelte";
import AgentList from "./components/AgentList.svelte";
import AgentListSidebarTab from "./components/AgentListSidebarTab.svelte";
import AgentStatusRow from "./components/AgentStatusRow.svelte";
import TaskSpawner from "./components/TaskSpawner.svelte";
import Columns from "./components/Columns.svelte";

const ROOT_ROW_KIND = "agent-dashboard";

/**
 * Stable id used to render an AgentDashboard via a child-row contributor.
 * Re-exported so AgentDashboardRow can compute the same key when
 * enumerating contributed children for nested rendering.
 */
export function agentDashboardRowId(dashboardId: string): string {
  return dashboardId;
}

// --- Manifest ---

export const agenticOrchestratorManifest: ExtensionManifest = {
  id: "agentic-orchestrator",
  name: "Agentic Orchestrator",
  version: "0.3.0",
  description:
    "Dashboards, widgets, and spawn UI for parallel AI agents. Consumes core's passive detection via api.agents.",
  entry: "./index.ts",
  included: true,
  permissions: [],
  contributes: {
    workspaceActions: [
      {
        id: "new-dashboard",
        title: "New Agent Dashboard",
        icon: "layout-dashboard",
      },
    ],
    secondarySidebarTabs: [
      // Global "Agents" tab pinned to the secondary sidebar that mirrors
      // `gnar:agent-list` with no scope. Lets users see every detected
      // agent (from the core registry) without opening a dashboard
      // markdown file.
      { id: "agents", label: "Agents", icon: "users" },
    ],
    events: ["workspace:activated"],
  },
};

// --- Registration ---

export function registerAgenticOrchestratorExtension(api: ExtensionAPI): void {
  const eventCleanups: Array<() => void> = [];

  // Tracks which dashboard ids are currently published as root rows so the
  // store-subscription diff can add/remove without re-emitting the full list.
  const publishedDashboardIds = new Set<string>();
  let dashboardUnsub: (() => void) | null = null;

  api.onActivate(() => {
    loadDashboards();

    api.registerWorkspaceAction("new-dashboard", {
      label: "New Agent Dashboard",
      icon: "layout-dashboard",
      handler: (ctx) => newDashboardFlow(api, ctx),
    });

    api.registerSecondarySidebarTab("agents", AgentListSidebarTab);

    api.registerRootRowRenderer(ROOT_ROW_KIND, AgentDashboardRow);

    api.registerMarkdownComponent("kanban", Kanban, {
      configSchema: {
        type: "object",
        properties: {
          dashboardId: {
            type: "string",
            description: "Optional dashboard scope. Omit for global view.",
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
          dashboardId: { type: "string" },
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
          dashboardId: { type: "string" },
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
          dashboardId: { type: "string", description: "Required scope." },
          defaultAgent: { type: "string", default: "claude-code" },
        },
        required: ["dashboardId"],
      },
    });

    // Project rows: contribute the dashboards that belong to this project.
    // project-scope's ProjectSectionContent enumerates these and renders
    // each via the root-row-renderer registered above.
    api.registerChildRowContributor("project", (projectId) =>
      getDashboardsForProject(projectId).map((d) => ({
        kind: ROOT_ROW_KIND,
        id: agentDashboardRowId(d.id),
      })),
    );

    // Dashboard rows: contribute worktree workspaces tagged with
    // metadata.parentDashboardId === <this dashboard>. The spawn
    // pipeline writes that tag when creating a worktree workspace
    // from a dashboard widget.
    api.registerChildRowContributor("dashboard", (dashboardId) => {
      let snapshot: Array<{ id: string; metadata?: Record<string, unknown> }> =
        [];
      const unsub = api.workspaces.subscribe((list) => {
        snapshot = list;
      });
      unsub();
      return snapshot
        .filter((ws) => ws.metadata?.parentDashboardId === dashboardId)
        .map((ws) => ({ kind: "workspace", id: ws.id }));
    });

    dashboardUnsub = dashboardsStore.subscribe((dashboards) => {
      const rootIds = new Set(
        dashboards.filter((d) => !d.parentProjectId).map((d) => d.id),
      );
      for (const id of rootIds) {
        if (!publishedDashboardIds.has(id)) {
          api.appendRootRow({ kind: ROOT_ROW_KIND, id });
          publishedDashboardIds.add(id);
        }
      }
      for (const id of [...publishedDashboardIds]) {
        if (!rootIds.has(id)) {
          api.removeRootRow({ kind: ROOT_ROW_KIND, id });
          publishedDashboardIds.delete(id);
        }
      }
    });

    // When the user returns to a workspace dedicated to a dashboard
    // (metadata.dashboardId set by openDashboard), make sure the
    // dashboard preview surface is present. If the user closed it
    // earlier and then navigated away, the workspace is empty —
    // re-spawn so revisiting never leaves the user at an empty pane
    // with no way back to the dashboard view.
    const handleWorkspaceActivated = (event: { type: string; id?: string }) => {
      const workspaceId = event.id;
      if (!workspaceId) return;
      let wsMetadata: Record<string, unknown> | undefined;
      const unsubLookup = api.workspaces.subscribe((list) => {
        const ws = list.find((w) => w.id === workspaceId);
        wsMetadata = ws?.metadata as Record<string, unknown> | undefined;
      });
      unsubLookup();
      const dashboardId = wsMetadata?.[DASHBOARD_WORKSPACE_META_KEY];
      if (typeof dashboardId !== "string") return;
      const dashboard = getDashboards().find((d) => d.id === dashboardId);
      if (dashboard) ensureDashboardSurface(dashboard);
    };
    api.on("workspace:activated", handleWorkspaceActivated);
    eventCleanups.push(() =>
      api.off("workspace:activated", handleWorkspaceActivated),
    );
  });

  api.onDeactivate(() => {
    for (const cleanup of eventCleanups) cleanup();
    eventCleanups.length = 0;

    if (dashboardUnsub) {
      dashboardUnsub();
      dashboardUnsub = null;
    }
    for (const id of publishedDashboardIds) {
      api.removeRootRow({ kind: ROOT_ROW_KIND, id });
    }
    publishedDashboardIds.clear();
  });
}

// --- Internal helpers ---

/**
 * Workspace action handler for `new-dashboard`. Two modes:
 *
 *   - **Project context** (`ctx.projectPath` set): the baseDir and color
 *     are inherited from the project and locked. The dialog only asks
 *     for a name — both derived fields stay off-screen so the user
 *     can't drift a dashboard's scope away from its host project.
 *   - **Root context** (no project): the dialog asks for baseDir
 *     (required, with Browse), name, and color.
 *
 * Writes the templated markdown only when the file does not already
 * exist — re-creating at the same path preserves the user's edits.
 */
async function newDashboardFlow(
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
          defaultValue: "Agent Dashboard",
          placeholder: "Agent Dashboard",
        },
      ]
    : [
        {
          key: "baseDir" as const,
          label: "Base directory",
          type: "directory" as const,
          required: true,
          defaultValue: "",
          pickerTitle: "Select dashboard base directory",
          placeholder: "Pick a folder...",
        },
        {
          key: "name" as const,
          label: "Name",
          defaultValue: "Agent Dashboard",
          placeholder: "Agent Dashboard",
        },
        {
          key: "color" as const,
          label: "Color",
          type: "color" as const,
          defaultValue: "purple",
        },
      ];

  const result = await api.showFormPrompt("New Agent Dashboard", fields, {
    submitLabel: "Create",
  });
  if (!result) return;

  const baseDir = (projectPath ?? result.baseDir ?? "").trim();
  if (!baseDir) return;
  const name = (result.name ?? "").trim();
  if (!name) return;
  // In project mode the color is inherited from the project. In root
  // mode we read the picked slot, falling back to purple if somehow the
  // field came back empty (e.g. a future refactor drops the default).
  const color = projectColor ?? (result.color || "purple");

  const dashboard = await createDashboard({
    name,
    baseDir,
    color,
    ...(projectId ? { parentProjectId: projectId } : {}),
  });

  try {
    await writeDashboardTemplate(dashboard);
  } catch (err) {
    api.reportError(`Failed to write dashboard markdown: ${err}`);
  }

  openDashboard(dashboard);
}
