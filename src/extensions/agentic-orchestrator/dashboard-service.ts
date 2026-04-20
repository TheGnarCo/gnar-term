/**
 * Dashboard Service — owns AgentDashboard entities and persists them to
 * GnarTermConfig.agentDashboards.
 *
 * Mirrors the shape of project-scope's project-service, but stores in
 * the shared config file (via getConfig/saveConfig) instead of the
 * per-extension api.state map. AgentDashboards are first-class user
 * data, parallel to projects/worktrees, so they belong in the same
 * config file other extensions can read.
 *
 * The service does NOT create the backing .md file on disk — that's
 * P8 (templated md generation). P4 only persists the metadata.
 */
import { get, writable, type Readable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { getConfig, saveConfig } from "../../lib/config";
import type { AgentDashboard } from "../../lib/config";
import { getHome } from "../../lib/services/service-helpers";
import {
  createPreviewSurfaceInPane,
  focusSurfaceById,
} from "../../lib/services/surface-service";
import { findPreviewSurfaceByPath } from "../../lib/services/preview-surface-registry";
import { workspaces, activeWorkspaceIdx } from "../../lib/stores/workspace";
import { createWorkspaceFromDef } from "../../lib/services/workspace-service";
import {
  getAllPanes,
  getAllSurfaces,
  isPreviewSurface,
  isTerminalSurface,
  type Workspace,
} from "../../lib/types";
import type { AgentRef as DetectedAgent } from "../api";

const _dashboards = writable<AgentDashboard[]>([]);
export const dashboardsStore: Readable<AgentDashboard[]> = _dashboards;

/** Default color slot for newly-created dashboards. Users can recolor. */
const DEFAULT_COLOR = "purple";

/** Hydrate the in-memory store from config — call once at activation. */
export function loadDashboards(): void {
  const dashboards = getConfig().agentDashboards ?? [];
  _dashboards.set([...dashboards]);
}

export function getDashboards(): AgentDashboard[] {
  return get(_dashboards);
}

export function getDashboard(id: string): AgentDashboard | undefined {
  return getDashboards().find((d) => d.id === id);
}

/**
 * Filter dashboards by parentProjectId. Pass `null` to get root-level
 * dashboards (i.e. those with no parentProjectId).
 */
export function getDashboardsForProject(
  projectId: string | null,
): AgentDashboard[] {
  const all = getDashboards();
  if (projectId === null) {
    return all.filter((d) => !d.parentProjectId);
  }
  return all.filter((d) => d.parentProjectId === projectId);
}

export interface CreateDashboardInput {
  name: string;
  baseDir: string;
  color?: string;
  parentProjectId?: string;
  /** For tests — bypasses path derivation. */
  pathOverride?: string;
}

async function persist(dashboards: AgentDashboard[]): Promise<void> {
  _dashboards.set([...dashboards]);
  await saveConfig({ agentDashboards: dashboards });
}

async function derivePath(
  id: string,
  baseDir: string,
  parentProjectId: string | undefined,
): Promise<string> {
  if (parentProjectId) {
    return `${baseDir}/.gnar-term/dashboards/${id}.md`;
  }
  const home = await getHome();
  return `${home}/.config/gnar-term/dashboards/${id}.md`;
}

export async function createDashboard(
  input: CreateDashboardInput,
): Promise<AgentDashboard> {
  const id = crypto.randomUUID();
  const path =
    input.pathOverride ??
    (await derivePath(id, input.baseDir, input.parentProjectId));

  const dashboard: AgentDashboard = {
    id,
    name: input.name,
    baseDir: input.baseDir,
    color: input.color ?? DEFAULT_COLOR,
    path,
    createdAt: new Date().toISOString(),
    ...(input.parentProjectId
      ? { parentProjectId: input.parentProjectId }
      : {}),
  };

  await persist([...getDashboards(), dashboard]);
  return dashboard;
}

export async function renameDashboard(id: string, name: string): Promise<void> {
  const next = getDashboards().map((d) => (d.id === id ? { ...d, name } : d));
  await persist(next);
}

export async function recolorDashboard(
  id: string,
  color: string,
): Promise<void> {
  const next = getDashboards().map((d) => (d.id === id ? { ...d, color } : d));
  await persist(next);
}

export async function deleteDashboard(id: string): Promise<void> {
  const next = getDashboards().filter((d) => d.id !== id);
  await persist(next);
}

/**
 * Filter agents to those whose owning surface's `cwd` is under the
 * dashboard's `baseDir`. Used by both the sidebar row (P5) and the
 * dashboard widgets (P6) so scoping logic stays consistent — an agent
 * "belongs" to a dashboard when its terminal is rooted somewhere
 * inside the dashboard's baseDir.
 *
 * Path containment uses prefix match with a trailing slash to avoid
 * `/work/proj` matching `/work/project-other`.
 */
export function dashboardScopedAgents(
  dashboard: AgentDashboard,
  allAgents: DetectedAgent[],
): DetectedAgent[] {
  const base = dashboard.baseDir.replace(/\/+$/, "");
  const prefix = `${base}/`;
  const wsList = get(workspaces);
  const wsCwdById = new Map<string, string>();
  for (const ws of wsList) {
    for (const s of getAllSurfaces(ws)) {
      if (isTerminalSurface(s) && s.cwd) {
        // First terminal surface's cwd represents the workspace root.
        if (!wsCwdById.has(ws.id)) {
          wsCwdById.set(ws.id, s.cwd);
        }
      }
    }
  }
  return allAgents.filter((a) => {
    const cwd = wsCwdById.get(a.workspaceId);
    if (!cwd) return false;
    return cwd === base || cwd.startsWith(prefix);
  });
}

/** Tag key placed on the owning workspace's metadata. */
export const DASHBOARD_WORKSPACE_META_KEY = "dashboardId";

/** Locate the workspace dedicated to a given dashboard, if one exists. */
export function findDashboardWorkspace(
  dashboardId: string,
): Workspace | undefined {
  return get(workspaces).find(
    (ws) =>
      (ws.metadata as Record<string, unknown> | undefined)?.[
        DASHBOARD_WORKSPACE_META_KEY
      ] === dashboardId,
  );
}

function paneHasDashboardSurface(
  ws: Workspace,
  dashboardPath: string,
): boolean {
  return getAllSurfaces(ws).some(
    (s) => isPreviewSurface(s) && s.path === dashboardPath,
  );
}

/**
 * Ensure a dashboard preview surface exists in the dashboard's dedicated
 * workspace, spawning one in the active pane if missing. Called both by
 * `openDashboard` (user click) and by the `workspace:activated` listener
 * (user returns to the dashboard workspace after closing the surface).
 */
export function ensureDashboardSurface(dashboard: AgentDashboard): void {
  const ws = findDashboardWorkspace(dashboard.id);
  if (!ws) return;
  if (paneHasDashboardSurface(ws, dashboard.path)) return;
  const pane = getAllPanes(ws.splitRoot).find((p) => p.id === ws.activePaneId);
  if (!pane) return;
  createPreviewSurfaceInPane(pane.id, dashboard.path, {
    focus: true,
    title: dashboard.name,
  });
}

/**
 * Open a dashboard — resolve the workspace dedicated to this dashboard,
 * creating one lazily on first open, switch to it, and guarantee a
 * preview surface is present in its active pane.
 *
 * If a preview surface already exists elsewhere (e.g. the user spawned
 * one via MCP before a dashboard workspace was created), focus that
 * instead of forcing a switch — the user's intent is "show me this
 * dashboard," not "rebuild my layout."
 *
 * Returns true on success (focused or spawned), false when there's no
 * pane to spawn into.
 */
export function openDashboard(dashboard: AgentDashboard): boolean {
  const existing = findPreviewSurfaceByPath(dashboard.path);
  if (existing) {
    focusSurfaceById(existing.surfaceId);
    return true;
  }

  const ws = findDashboardWorkspace(dashboard.id);
  if (ws) {
    // Switch to the dashboard workspace before spawning, so the surface
    // lands in the correct pane regardless of which workspace was active.
    const idx = get(workspaces).findIndex((w) => w.id === ws.id);
    if (idx >= 0) activeWorkspaceIdx.set(idx);
    const pane = getAllPanes(ws.splitRoot).find(
      (p) => p.id === ws.activePaneId,
    );
    if (!pane) return false;
    const surface = createPreviewSurfaceInPane(pane.id, dashboard.path, {
      focus: true,
      title: dashboard.name,
    });
    return surface !== null;
  }

  // No dedicated workspace yet — build one whose only surface is the
  // dashboard preview. Tagging via metadata lets workspace:activated
  // listeners find it later and re-spawn the surface when empty.
  void createWorkspaceFromDef({
    name: dashboard.name,
    layout: {
      pane: {
        surfaces: [
          {
            type: "preview",
            path: dashboard.path,
            name: dashboard.name,
            focus: true,
          },
        ],
      },
    },
    metadata: { [DASHBOARD_WORKSPACE_META_KEY]: dashboard.id },
  });
  return true;
}

/**
 * Templated default markdown content for a freshly-created dashboard.
 * Kanban spans full width at the top; `task-spawner` and `issues` sit
 * side by side below it via the built-in `gnar:columns` layout widget.
 * The dashboard's H1 serves as the only title — widgets render without
 * their own redundant section headers.
 */
export function buildDashboardMarkdown(dashboard: AgentDashboard): string {
  return `# ${dashboard.name}

Live status of agents working in \`${dashboard.baseDir}\`.

\`\`\`gnar:kanban
dashboardId: ${dashboard.id}
\`\`\`

\`\`\`gnar:columns
children:
  - name: task-spawner
    config:
      dashboardId: ${dashboard.id}
  - name: issues
    config:
      dashboardId: ${dashboard.id}
\`\`\`
`;
}

/**
 * Write the templated markdown file for a dashboard. Idempotent — if the
 * file already exists, leaves it alone (so a user's edits survive a
 * re-create with the same path).
 *
 * Uses direct Tauri `invoke` rather than the extension `api.invoke` so
 * the write can target `~/.config/gnar-term/dashboards/` — that path is
 * blocked from extensions by the PATH_COMMANDS guard, but root-level
 * dashboards must live there.
 */
export async function writeDashboardTemplate(
  dashboard: AgentDashboard,
): Promise<void> {
  const exists = await invoke<boolean>("file_exists", {
    path: dashboard.path,
  }).catch(() => false);
  if (exists) return;
  const dir = dashboard.path.replace(/\/[^/]+$/, "");
  await invoke("ensure_dir", { path: dir });
  await invoke("write_file", {
    path: dashboard.path,
    content: buildDashboardMarkdown(dashboard),
  });
}

/** Test-only reset. Mirrors `_resetWorktreeService` pattern. */
export function _resetDashboardService(): void {
  _dashboards.set([]);
}
