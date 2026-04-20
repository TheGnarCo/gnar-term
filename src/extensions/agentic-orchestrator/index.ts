/**
 * Agentic Orchestrator — passive AI agent detector
 *
 * Watches terminal surfaces for known AI tool signatures (title patterns,
 * OSC sequences) and tracks their status. No harness launching — purely
 * observational.
 */
import type { ExtensionManifest, ExtensionAPI, AppEvent } from "../api";
import {
  initRegistry,
  generateAgentId,
  registerAgent,
  unregisterAgent,
  updateAgentStatus,
  getAgents,
} from "./agent-registry";
import {
  createStatusTracker,
  type StatusTracker,
  type TrackerMode,
} from "./status-tracker";
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

// --- Agent pattern matching ---

export interface AgentPattern {
  name: string;
  titlePatterns: string[];
  oscDetectable: boolean;
}

const DEFAULT_PATTERNS: AgentPattern[] = [
  { name: "Claude Code", titlePatterns: ["claude"], oscDetectable: true },
  { name: "Codex", titlePatterns: ["codex"], oscDetectable: false },
  { name: "Aider", titlePatterns: ["aider"], oscDetectable: false },
  { name: "Cursor", titlePatterns: ["cursor"], oscDetectable: false },
  {
    name: "GitHub Copilot",
    titlePatterns: ["ghcs", "github-copilot"],
    oscDetectable: false,
  },
];

function matchesPattern(
  title: string,
  patterns: AgentPattern[],
): AgentPattern | null {
  const lower = title.toLowerCase();
  for (const pattern of patterns) {
    if (pattern.titlePatterns.some((p) => lower.includes(p))) {
      return pattern;
    }
  }
  return null;
}

// --- Tracked surface state ---

interface TrackedSurface {
  surfaceId: string;
  agentId: string | null;
  agentPattern: AgentPattern | null;
  tracker: StatusTracker | null;
  unsubscribeOutput: (() => void) | null;
}

// --- Manifest ---

export const agenticOrchestratorManifest: ExtensionManifest = {
  id: "agentic-orchestrator",
  name: "Agentic Orchestrator",
  version: "0.2.0",
  description: "Passive AI agent detector with status tracking",
  entry: "./index.ts",
  included: true,
  permissions: ["observe"],
  contributes: {
    settings: {
      fields: {
        idleTimeout: {
          type: "number",
          title: "Idle Timeout (seconds)",
          description: "Seconds of no output before marking agent as idle",
          default: 30,
        },
        knownAgents: {
          type: "string",
          title: "Known Agents (JSON)",
          description:
            'JSON array of additional agent patterns: [{"name":"MyAgent","titlePatterns":["myagent"],"oscDetectable":false}]',
          default: "[]",
        },
      },
    },
    workspaceActions: [
      {
        id: "new-dashboard",
        title: "New Agent Dashboard",
        icon: "layout-dashboard",
      },
    ],
    secondarySidebarTabs: [
      // P11: a global "Agents" tab pinned to the secondary sidebar that
      // mirrors `gnar:agent-list` with no scope. Lets users see every
      // detected agent without opening a dashboard markdown file.
      { id: "agents", label: "Agents", icon: "users" },
    ],
    events: [
      "surface:created",
      "surface:closed",
      "surface:titleChanged",
      "workspace:activated",
      "extension:harness:statusChanged",
    ],
  },
};

// --- Registration ---

export function registerAgenticOrchestratorExtension(api: ExtensionAPI): void {
  const trackedSurfaces = new Map<string, TrackedSurface>();
  const eventCleanups: Array<() => void> = [];

  // Tracks which dashboard ids are currently published as root rows so the
  // store-subscription diff can add/remove without re-emitting the full list.
  const publishedDashboardIds = new Set<string>();
  let dashboardUnsub: (() => void) | null = null;

  api.onActivate(() => {
    initRegistry(api);
    loadDashboards();

    api.registerWorkspaceAction("new-dashboard", {
      label: "New Agent Dashboard",
      icon: "layout-dashboard",
      handler: (ctx) => newDashboardFlow(api, ctx),
    });

    // P11: secondary sidebar tab — global "Agents" view.
    api.registerSecondarySidebarTab("agents", AgentListSidebarTab);

    api.registerRootRowRenderer(ROOT_ROW_KIND, AgentDashboardRow);

    // P6: built-in markdown-components surfaced via gnar:<name> directives
    // inside dashboard markdown files. configSchema is informational
    // (used by the list_markdown_components MCP tool); no runtime
    // validation is performed.
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
    // metadata.parentDashboardId === <this dashboard>. P7 starts writing
    // that tag when spawning workspaces from a dashboard issue. Until
    // then this contributor is a no-op for every dashboard.
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

    // Build merged pattern list: defaults + user-defined
    const patterns = buildPatternList(api);

    // React to agent status changes: mark unread, update workspace + surface dots
    const handleStatusChanged = (event: AppEvent) => {
      const e = event as Record<string, unknown>;
      const status = e.status as string;
      const workspaceId = e.workspaceId as string | undefined;
      const surfaceId = e.surfaceId as string | undefined;

      if (status === "waiting" && surfaceId) {
        api.markSurfaceUnread(surfaceId);
      }

      if (workspaceId) {
        api.setWorkspaceIndicator(
          workspaceId,
          status === "closed" ? null : status,
        );

        // Set per-surface status item for tab dot rendering
        if (surfaceId) {
          if (status === "closed") {
            api.clearStatus(workspaceId, `surface:${surfaceId}`);
          } else {
            api.setStatus(workspaceId, `surface:${surfaceId}`, {
              category: "process",
              priority: 0,
              label: status,
              variant:
                status === "running"
                  ? "success"
                  : status === "waiting"
                    ? "warning"
                    : "muted",
              metadata: { surfaceId },
            });
          }
        }
      }
    };
    api.on("extension:harness:statusChanged", handleStatusChanged);
    eventCleanups.push(() =>
      api.off("extension:harness:statusChanged", handleStatusChanged),
    );

    // On surface created: if it's a terminal, subscribe to output
    const handleSurfaceCreated = (event: AppEvent) => {
      const e = event as Record<string, unknown>;
      const surfaceId = e.id as string | undefined;
      const kind = e.kind as string | undefined;
      const title = (e.title as string) || "";

      if (!surfaceId || kind !== "terminal") return;

      const tracked: TrackedSurface = {
        surfaceId,
        agentId: null,
        agentPattern: null,
        tracker: null,
        unsubscribeOutput: null,
      };

      // Check initial title for agent match
      const match = matchesPattern(title, patterns);
      if (match) {
        attachAgent(api, tracked, match, patterns);
      }

      // Subscribe to output for detection and status tracking.
      // Output is also scanned for agent detection as a fallback when
      // the shell title doesn't update (e.g., missing precmd hooks).
      const unsubOutput = api.onSurfaceOutput(surfaceId, (data: string) => {
        try {
          if (tracked.tracker) {
            // Agent already detected — feed status tracker
            if (tracked.agentPattern?.oscDetectable && data.includes("\x1b]")) {
              tracked.tracker.onNotification(data);
            } else {
              tracked.tracker.onOutput();
            }
          } else {
            // No agent detected yet — scan output for agent signatures
            const match = matchesPattern(data, patterns);
            if (match) {
              attachAgent(api, tracked, match, patterns);
            }
          }
        } catch (err) {
          // A throw from tracker/attachAgent leaves the dot frozen. Surface
          // to the error store AND detach so the user sees both a toast and
          // a cleared indicator rather than permanent staleness.
          api.reportError(
            `Output observer error on surface ${tracked.surfaceId}: ${err}`,
          );
          if (tracked.agentId) {
            try {
              detachAgent(api, tracked);
            } catch {
              /* already reporting — swallow secondary cleanup failures */
            }
          }
        }
      });
      tracked.unsubscribeOutput = unsubOutput;

      trackedSurfaces.set(surfaceId, tracked);
    };
    api.on("surface:created", handleSurfaceCreated);
    eventCleanups.push(() => api.off("surface:created", handleSurfaceCreated));

    // On title change: detect new agents or agent exit
    const handleTitleChanged = (event: AppEvent) => {
      const e = event as Record<string, unknown>;
      const surfaceId = e.id as string | undefined;
      const title = (e.title as string) || "";

      if (!surfaceId) return;

      const tracked = trackedSurfaces.get(surfaceId);
      if (!tracked) return;

      const match = matchesPattern(title, patterns);

      if (match && !tracked.agentId) {
        // New agent detected
        attachAgent(api, tracked, match, patterns);
      } else if (match && tracked.agentId) {
        // Agent still present — forward title change to tracker
        if (tracked.tracker) {
          tracked.tracker.onTitleChange(title);
        }
      } else if (!match && tracked.agentId) {
        // Agent exited — title no longer matches
        detachAgent(api, tracked);
      }
    };
    api.on("surface:titleChanged", handleTitleChanged);
    eventCleanups.push(() =>
      api.off("surface:titleChanged", handleTitleChanged),
    );

    // Bootstrap tracking for every pre-existing terminal surface across ALL
    // workspaces and ALL panes — including backgrounded workspaces and the
    // non-active side of a split. surface:created only fires for surfaces
    // created AFTER this listener attached, so restored surfaces would
    // otherwise be permanently untracked.
    for (const surf of api.getAllTerminalSurfaces()) {
      if (!trackedSurfaces.has(surf.id)) {
        handleSurfaceCreated({
          type: "surface:created",
          id: surf.id,
          kind: "terminal",
          title: surf.title,
        });
      }
    }

    // On surface closed: clean up
    const handleSurfaceClosed = (event: AppEvent) => {
      const e = event as Record<string, unknown>;
      const surfaceId = e.id as string | undefined;
      if (!surfaceId) return;

      const tracked = trackedSurfaces.get(surfaceId);
      if (!tracked) return;

      if (tracked.agentId) {
        detachAgent(api, tracked);
      }
      if (tracked.unsubscribeOutput) {
        tracked.unsubscribeOutput();
      }
      trackedSurfaces.delete(surfaceId);
    };
    api.on("surface:closed", handleSurfaceClosed);
    eventCleanups.push(() => api.off("surface:closed", handleSurfaceClosed));

    // When the user returns to a workspace dedicated to a dashboard
    // (metadata.dashboardId set by openDashboard), make sure the
    // dashboard preview surface is present. If the user closed it
    // earlier and then navigated away, the workspace is empty —
    // re-spawn so revisiting never leaves the user at an empty pane
    // with no way back to the dashboard view.
    const handleWorkspaceActivated = (event: AppEvent) => {
      const e = event as Record<string, unknown>;
      const workspaceId = e.id as string | undefined;
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
    // Detach each agent BEFORE removing listeners — detachAgent emits a
    // "closed" status event that handleStatusChanged consumes to clear the
    // workspace indicator (_agent source). Without this, _agent items leak
    // past deactivation because REGISTRY_CLEANUP_FNS only clears items
    // sourced with the extension id, not "_agent".
    for (const tracked of trackedSurfaces.values()) {
      if (tracked.agentId) {
        detachAgent(api, tracked);
      } else {
        // No agent attached — still need to destroy tracker/unsubscribe.
        if (tracked.tracker) tracked.tracker.destroy();
        if (tracked.unsubscribeOutput) tracked.unsubscribeOutput();
      }
    }
    trackedSurfaces.clear();

    // Remove event listeners
    for (const cleanup of eventCleanups) {
      cleanup();
    }
    eventCleanups.length = 0;

    // Tear down dashboard subscription + drop published rows. The renderer
    // itself unregisters via REGISTRY_CLEANUP_FNS (sourced under this
    // extension id) so we only need to clear our own bookkeeping.
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

function buildPatternList(api: ExtensionAPI): AgentPattern[] {
  const patterns = [...DEFAULT_PATTERNS];
  const knownAgentsJson = api.getSetting<string>("knownAgents");
  if (knownAgentsJson) {
    try {
      const userPatterns = JSON.parse(knownAgentsJson) as AgentPattern[];
      if (Array.isArray(userPatterns)) {
        for (const p of userPatterns) {
          if (p.name && Array.isArray(p.titlePatterns)) {
            patterns.push({
              name: p.name,
              titlePatterns: p.titlePatterns,
              oscDetectable: p.oscDetectable ?? false,
            });
          }
        }
      }
    } catch {
      // Invalid JSON — ignore user patterns
    }
  }
  return patterns;
}

function attachAgent(
  api: ExtensionAPI,
  tracked: TrackedSurface,
  pattern: AgentPattern,
  _patterns: AgentPattern[],
): void {
  const agentId = generateAgentId();
  const idleTimeoutMs = (api.getSetting<number>("idleTimeout") ?? 30) * 1000;
  const mode: TrackerMode = pattern.oscDetectable ? "osc" : "title-only";

  // Resolve workspace ID from the surface's owning workspace — NOT the active
  // one. attachAgent can fire from output-scan after the user has switched
  // workspaces, and snapshotting activeWorkspace would bleed the agent's
  // dot/status onto the wrong workspace.
  const workspaceId = api.getWorkspaceIdForSurface(tracked.surfaceId) ?? "";

  const tracker = createStatusTracker(
    idleTimeoutMs,
    (status) => {
      updateAgentStatus(agentId, status);
      api.emit("extension:harness:statusChanged", {
        status,
        surfaceId: tracked.surfaceId,
        workspaceId,
        agentName: pattern.name,
      });
    },
    mode,
  );

  registerAgent({
    agentId,
    agentName: pattern.name,
    surfaceId: tracked.surfaceId,
    workspaceId,
    status: "idle",
    createdAt: new Date().toISOString(),
    lastStatusChange: new Date().toISOString(),
  });

  tracked.agentId = agentId;
  tracked.agentPattern = pattern;
  tracked.tracker = tracker;
}

function detachAgent(api: ExtensionAPI, tracked: TrackedSurface): void {
  if (!tracked.agentId) return;

  // Emit closed status before unregistering
  const agents = getAgents();
  const agent = agents.find((a) => a.agentId === tracked.agentId);
  if (agent) {
    api.emit("extension:harness:statusChanged", {
      status: "closed",
      surfaceId: tracked.surfaceId,
      workspaceId: agent.workspaceId,
      agentName: agent.agentName,
    });
  }

  if (tracked.tracker) {
    tracked.tracker.destroy();
  }
  unregisterAgent(tracked.agentId);

  tracked.agentId = null;
  tracked.agentPattern = null;
  tracked.tracker = null;
}
