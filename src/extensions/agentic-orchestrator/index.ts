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
import { resolveProjectColor } from "../api";
import { get } from "svelte/store";
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
    events: ["workspace:activated", "workspace:created", "workspace:closed"],
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

    // Register with railColor + label resolvers so drag overlays + drop
    // ghosts paint the dashboard's own color and name — without these
    // the drag state falls back to theme.accent + no label and reads as
    // a generic row rather than this specific dashboard.
    api.registerRootRowRenderer(ROOT_ROW_KIND, AgentDashboardRow, {
      railColor: (rowId: string) => {
        const d = getDashboards().find((dash) => dash.id === rowId);
        if (!d) return undefined;
        return resolveProjectColor(d.color, get(api.theme));
      },
      label: (rowId: string) =>
        getDashboards().find((dash) => dash.id === rowId)?.name,
    });

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

    // Worktree workspaces tagged with metadata.parentDashboardId are now
    // rendered directly by AgentDashboardRow via the shared
    // WorkspaceListView component (see that component's nested-workspaces
    // block). The previous child-row-contributor emitted workspace-kind
    // rows that no registered renderer claimed — rendering them through
    // WorkspaceListView removes that dead wire and gives nested workspaces
    // the same drag/reorder/color inheritance as root-level ones.

    // Regenerate-dashboard command — surfaced on the EmptySurface view
    // when the active workspace is the host of an agent dashboard
    // (metadata.dashboardId set). Reads that id off the active workspace,
    // resolves the dashboard, and ensures its preview surface exists in
    // the workspace's active pane. A no-op when the active workspace
    // doesn't host a dashboard (EmptySurface gates the button anyway).
    api.registerCommand(
      "agentic-orchestrator:regenerate-active-dashboard",
      () => {
        let activeMetadata: Record<string, unknown> | undefined;
        const unsub = api.activeWorkspace.subscribe((w) => {
          activeMetadata = w?.metadata as Record<string, unknown> | undefined;
        });
        unsub();
        const dashboardId = activeMetadata?.[DASHBOARD_WORKSPACE_META_KEY];
        if (typeof dashboardId !== "string") return;
        const dashboard = getDashboards().find((d) => d.id === dashboardId);
        if (dashboard) ensureDashboardSurface(dashboard);
      },
      { title: "Regenerate Dashboard" },
    );

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

    // Workspaces that belong to a dashboard — either as spawned worktrees
    // (metadata.parentDashboardId) or as the dashboard's own hosting
    // workspace (metadata.dashboardId) — render nested under their
    // dashboard in the sidebar. Claim them so they don't ALSO appear at
    // root, mirroring project-scope's claim-on-create pattern.
    function isDashboardOwned(
      metadata: Record<string, unknown> | undefined,
    ): boolean {
      if (!metadata) return false;
      return (
        typeof metadata.parentDashboardId === "string" ||
        typeof metadata[DASHBOARD_WORKSPACE_META_KEY] === "string"
      );
    }

    const handleWorkspaceCreated = (event: {
      type: string;
      id?: string;
      metadata?: unknown;
    }) => {
      const workspaceId = event.id;
      if (!workspaceId) return;
      if (isDashboardOwned(event.metadata as Record<string, unknown>)) {
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

    // Catch workspaces that were already open when the extension
    // activated (e.g. restored-from-session). Without this, pre-existing
    // dashboard-owned workspaces appear at root until the user closes and
    // reopens them.
    const unsubInitialScan = api.workspaces.subscribe((list) => {
      for (const ws of list) {
        if (isDashboardOwned(ws.metadata as Record<string, unknown>)) {
          api.claimWorkspace(ws.id);
        }
      }
    });
    unsubInitialScan();
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
