/**
 * Orchestrator Service — owns AgentOrchestrator entities and persists
 * them to GnarTermConfig.agentOrchestrators.
 *
 * Mirrors the shape of project-scope's project-service. AgentOrchestrators
 * are first-class user data, parallel to projects/worktrees, so they live
 * in the shared config file (via getConfig/saveConfig) other extensions
 * can read.
 *
 * Each orchestrator owns a dedicated **Dashboard workspace**: a workspace
 * with `metadata.isDashboard = true` whose single Live Preview surface
 * renders the orchestrator's markdown file. The Dashboard is created
 * eagerly alongside the orchestrator and destroyed with it; users cannot
 * open/close Dashboards directly.
 */
import { get, writable, type Readable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { getConfig, saveConfig } from "../../lib/config";
import type { AgentOrchestrator } from "../../lib/config";
import { getHome } from "../../lib/services/service-helpers";
import { workspaces, activeWorkspaceIdx } from "../../lib/stores/workspace";
import {
  createWorkspaceFromDef,
  closeWorkspace,
} from "../../lib/services/workspace-service";
import {
  getAllSurfaces,
  isTerminalSurface,
  type Workspace,
} from "../../lib/types";
import type { AgentRef as DetectedAgent } from "../api";

const _orchestrators = writable<AgentOrchestrator[]>([]);
export const orchestratorsStore: Readable<AgentOrchestrator[]> = _orchestrators;

/** Default color slot for newly-created orchestrators. Users can recolor. */
const DEFAULT_COLOR = "purple";

/** Metadata key on the Dashboard workspace that points back at its orchestrator. */
export const ORCHESTRATOR_WORKSPACE_META_KEY = "orchestratorId";

/** Metadata marker: the workspace is a constrained Dashboard (no tabs/splits/terminals). */
export const DASHBOARD_METADATA_KEY = "isDashboard";

/** Hydrate the in-memory store from config — call once at activation. */
export function loadOrchestrators(): void {
  const orchestrators = getConfig().agentOrchestrators ?? [];
  _orchestrators.set([...orchestrators]);
}

export function getOrchestrators(): AgentOrchestrator[] {
  return get(_orchestrators);
}

export function getOrchestrator(id: string): AgentOrchestrator | undefined {
  return getOrchestrators().find((o) => o.id === id);
}

/**
 * Filter orchestrators by parentGroupId. Pass `null` to get root-level
 * orchestrators (i.e. those with no parentGroupId).
 */
export function getOrchestratorsForProject(
  groupId: string | null,
): AgentOrchestrator[] {
  const all = getOrchestrators();
  if (groupId === null) {
    return all.filter((o) => !o.parentGroupId);
  }
  return all.filter((o) => o.parentGroupId === groupId);
}

export interface CreateOrchestratorInput {
  name: string;
  baseDir: string;
  color?: string;
  parentGroupId?: string;
  /** For tests — bypasses path derivation. */
  pathOverride?: string;
}

async function persist(orchestrators: AgentOrchestrator[]): Promise<void> {
  _orchestrators.set([...orchestrators]);
  await saveConfig({ agentOrchestrators: orchestrators });
}

async function derivePath(
  id: string,
  baseDir: string,
  parentGroupId: string | undefined,
): Promise<string> {
  if (parentGroupId) {
    return `${baseDir}/.gnar-term/orchestrators/${id}.md`;
  }
  const home = await getHome();
  return `${home}/.config/gnar-term/orchestrators/${id}.md`;
}

/**
 * Create a Dashboard workspace dedicated to an orchestrator. Returns the
 * new workspace id so the orchestrator record can link to it.
 *
 * The Dashboard is always named "Dashboard". When the orchestrator has a
 * `parentGroupId`, the Dashboard workspace is tagged with `groupId` too
 * so workspace-groups claims it and renders it inside the group's
 * nested list (as an agentic Dashboard tile).
 */
export async function createOrchestratorDashboardWorkspace(
  orchestrator: AgentOrchestrator,
): Promise<string> {
  // When nested under a workspace group, the Dashboard tile renders in
  // the group's list and needs to self-identify — use the orchestrator
  // name. When root-level, the tile sits inside the orchestrator's own
  // nested list below its banner; the banner already carries the name,
  // so the tile uses the generic "Dashboard" label.
  const wsName = orchestrator.parentGroupId ? orchestrator.name : "Dashboard";
  return await createWorkspaceFromDef({
    name: wsName,
    layout: {
      pane: {
        surfaces: [
          {
            type: "preview",
            path: orchestrator.path,
            name: orchestrator.name,
            focus: true,
          },
        ],
      },
    },
    metadata: {
      [DASHBOARD_METADATA_KEY]: true,
      [ORCHESTRATOR_WORKSPACE_META_KEY]: orchestrator.id,
      ...(orchestrator.parentGroupId
        ? { groupId: orchestrator.parentGroupId }
        : {}),
    },
  });
}

/**
 * Create an orchestrator AND its Dashboard workspace. The workspace id
 * is stored back on the orchestrator as `dashboardWorkspaceId` before
 * persistence, so the link survives restart.
 */
export async function createOrchestrator(
  input: CreateOrchestratorInput,
): Promise<AgentOrchestrator> {
  const id = crypto.randomUUID();
  const path =
    input.pathOverride ??
    (await derivePath(id, input.baseDir, input.parentGroupId));

  const base: AgentOrchestrator = {
    id,
    name: input.name,
    baseDir: input.baseDir,
    color: input.color ?? DEFAULT_COLOR,
    path,
    createdAt: new Date().toISOString(),
    ...(input.parentGroupId ? { parentGroupId: input.parentGroupId } : {}),
  };

  const dashboardWorkspaceId = await createOrchestratorDashboardWorkspace(base);
  const orchestrator: AgentOrchestrator = { ...base, dashboardWorkspaceId };

  await persist([...getOrchestrators(), orchestrator]);
  return orchestrator;
}

export async function renameOrchestrator(
  id: string,
  name: string,
): Promise<void> {
  const next = getOrchestrators().map((o) =>
    o.id === id ? { ...o, name } : o,
  );
  await persist(next);
}

export async function recolorOrchestrator(
  id: string,
  color: string,
): Promise<void> {
  const next = getOrchestrators().map((o) =>
    o.id === id ? { ...o, color } : o,
  );
  await persist(next);
}

/**
 * Delete the orchestrator AND close its Dashboard workspace. Nested
 * worktree workspaces tagged with `parentOrchestratorId` are NOT
 * closed — users manage those via their own close affordances.
 */
export async function deleteOrchestrator(id: string): Promise<void> {
  const orchestrator = getOrchestrator(id);
  if (orchestrator?.dashboardWorkspaceId) {
    const wsIdx = get(workspaces).findIndex(
      (w) => w.id === orchestrator.dashboardWorkspaceId,
    );
    if (wsIdx >= 0) closeWorkspace(wsIdx);
  }
  const next = getOrchestrators().filter((o) => o.id !== id);
  await persist(next);
}

/**
 * Filter agents to those that belong to an orchestrator. An agent belongs
 * when either:
 *   1. its workspace's first terminal cwd is under `orchestrator.baseDir`
 *      (covers terminals rooted in the project), OR
 *   2. its workspace carries `metadata.parentOrchestratorId === orchestrator.id`
 *      (covers worktrees spawned by the orchestrator's widgets — those
 *      live in a sibling directory of `baseDir`, so the prefix match
 *      rejects them).
 *
 * Path containment uses prefix match with a trailing slash to avoid
 * `/work/proj` matching `/work/project-other`.
 */
export function orchestratorScopedAgents(
  orchestrator: AgentOrchestrator,
  allAgents: DetectedAgent[],
): DetectedAgent[] {
  const base = orchestrator.baseDir.replace(/\/+$/, "");
  const prefix = `${base}/`;
  const wsList = get(workspaces);
  const wsCwdById = new Map<string, string>();
  const wsParentOrchById = new Map<string, string>();
  for (const ws of wsList) {
    for (const s of getAllSurfaces(ws)) {
      if (isTerminalSurface(s) && s.cwd) {
        if (!wsCwdById.has(ws.id)) {
          wsCwdById.set(ws.id, s.cwd);
        }
      }
    }
    const parentOrchId = (ws.metadata as Record<string, unknown> | undefined)
      ?.parentOrchestratorId;
    if (typeof parentOrchId === "string") {
      wsParentOrchById.set(ws.id, parentOrchId);
    }
  }
  return allAgents.filter((a) => {
    if (wsParentOrchById.get(a.workspaceId) === orchestrator.id) {
      return true;
    }
    const cwd = wsCwdById.get(a.workspaceId);
    if (!cwd) return false;
    return cwd === base || cwd.startsWith(prefix);
  });
}

/** Locate the Dashboard workspace dedicated to a given orchestrator, if one exists. */
export function findOrchestratorDashboardWorkspace(
  orchestratorId: string,
): Workspace | undefined {
  return get(workspaces).find(
    (ws) =>
      (ws.metadata as Record<string, unknown> | undefined)?.[
        ORCHESTRATOR_WORKSPACE_META_KEY
      ] === orchestratorId,
  );
}

/**
 * Switch to an orchestrator's Dashboard workspace. Since the Dashboard is
 * created eagerly with the orchestrator, it always exists — this is a
 * pure activation call. Returns true on success.
 */
export function openOrchestratorDashboard(
  orchestrator: AgentOrchestrator,
): boolean {
  const ws = findOrchestratorDashboardWorkspace(orchestrator.id);
  if (!ws) return false;
  const idx = get(workspaces).findIndex((w) => w.id === ws.id);
  if (idx < 0) return false;
  activeWorkspaceIdx.set(idx);
  return true;
}

/**
 * Ensure each orchestrator has a Dashboard workspace. Called during
 * activation after `loadOrchestrators()` to recover any orchestrator
 * whose Dashboard was lost (first run after the redesign, or corruption).
 * New workspace ids are written back into the orchestrator records.
 */
export async function ensureOrchestratorDashboards(): Promise<void> {
  const orchestrators = getOrchestrators();
  let changed = false;
  const next: AgentOrchestrator[] = [];
  for (const o of orchestrators) {
    const hasWs =
      !!o.dashboardWorkspaceId &&
      get(workspaces).some((w) => w.id === o.dashboardWorkspaceId);
    if (hasWs) {
      next.push(o);
      continue;
    }
    const dashboardWorkspaceId = await createOrchestratorDashboardWorkspace(o);
    next.push({ ...o, dashboardWorkspaceId });
    changed = true;
  }
  if (changed) {
    await persist(next);
  }
}

/**
 * Templated default markdown content for a freshly-created orchestrator's
 * Dashboard. Kanban spans full width at the top; `task-spawner` and
 * `issues` sit side by side below it via the built-in `gnar:columns`
 * layout widget. The H1 serves as the only title — widgets render
 * without their own redundant section headers.
 *
 * Widgets pull scope from the enclosing DashboardHostContext (spec §5.3),
 * so no `orchestratorId:` props are emitted. Nested-under-group
 * orchestrators get their groupId from the workspace metadata; root-level
 * orchestrators render inert until Stage 7 migrates them away.
 */
export function buildOrchestratorDashboardMarkdown(
  orchestrator: AgentOrchestrator,
): string {
  return `# ${orchestrator.name}

Live status of agents working in \`${orchestrator.baseDir}\`.

\`\`\`gnar:kanban
\`\`\`

\`\`\`gnar:columns
children:
  - name: task-spawner
    config: {}
  - name: issues
    config: {}
\`\`\`
`;
}

/**
 * Write the templated markdown file for an orchestrator. Idempotent —
 * if the file already exists, leaves it alone (so a user's edits survive
 * a re-create with the same path).
 */
export async function writeOrchestratorDashboardTemplate(
  orchestrator: AgentOrchestrator,
): Promise<void> {
  const exists = await invoke<boolean>("file_exists", {
    path: orchestrator.path,
  }).catch(() => false);
  if (exists) return;
  const dir = orchestrator.path.replace(/\/[^/]+$/, "");
  await invoke("ensure_dir", { path: dir });
  await invoke("write_file", {
    path: orchestrator.path,
    content: buildOrchestratorDashboardMarkdown(orchestrator),
  });
}

/** Test-only reset. */
export function _resetOrchestratorService(): void {
  _orchestrators.set([]);
}
