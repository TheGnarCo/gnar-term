/**
 * Workspace Service — CRUD + flow functions for the core
 * Workspace primitive. Relocated from the project-scope extension
 * in Stage 5; see ADR 004.
 *
 * Components and core commands call into this module rather than
 * touching the `workspacesStore` directly so state transitions
 * (adding to root-row order, claiming nestedWorkspaces, tearing down the
 * Dashboard workspace on delete) stay colocated with the store write.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import type { SurfaceDef, Workspace } from "../config";
import { GROUP_COLOR_SLOTS } from "../../extensions/api";
import { appendRootRow, removeRootRow } from "../stores/root-row-order";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../stores/nested-workspace";
import { claimWorkspace, unclaimWorkspace } from "./claimed-workspace-registry";
import {
  getWorkspace,
  getWorkspaces,
  setActiveWorkspaceId,
  setWorkspaces,
} from "../stores/workspaces";
import {
  createNestedWorkspaceFromDef,
  closeNestedWorkspace,
  schedulePersist,
} from "./nested-workspace-service";
import { eventBus } from "./event-bus";
import {
  getAllPanes,
  type NestedWorkspace,
  type NestedWorkspaceMetadata,
} from "../types";
import { wsMeta } from "./service-helpers";
import {
  getDashboardContribution,
  getDashboardContributions,
} from "./dashboard-contribution-registry";
import { releaseWorkspaceDirtyStore } from "./workspace-git-dirty-store";

export const WORKSPACE_GROUP_STATE_CHANGED =
  "extension:workspace-group:state-changed";

function emitStateChanged(metadata: Record<string, unknown> = {}): void {
  eventBus.emit({
    type: WORKSPACE_GROUP_STATE_CHANGED,
    ...metadata,
  });
}

export function addWorkspace(workspace: Workspace): void {
  setWorkspaces([...getWorkspaces(), workspace]);
  appendRootRow({ kind: "workspace", id: workspace.id });
  emitStateChanged({ parentWorkspaceId: workspace.id });
}

export function updateWorkspace(
  id: string,
  patch: Partial<Omit<Workspace, "id">>,
): void {
  const next = getWorkspaces().map((g) =>
    g.id === id ? { ...g, ...patch } : g,
  );
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId: id });
}

/**
 * Toggle the `locked` flag on a workspace. Locked workspaces have
 * their drag-reorder, delete, and archive affordances suppressed.
 * No-op if no workspace with the given id exists.
 */
export function toggleWorkspaceLock(id: string): void {
  const workspaces = getWorkspaces();
  const idx = workspaces.findIndex((g) => g.id === id);
  if (idx === -1) return;
  const next = workspaces.map((g) =>
    g.id === id ? { ...g, locked: !g.locked } : g,
  );
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId: id });
}

export function deleteWorkspace(id: string): void {
  const workspace = getWorkspace(id);
  if (workspace?.locked) return;
  const next = getWorkspaces().filter((g) => g.id !== id);
  setWorkspaces(next);
  removeRootRow({ kind: "workspace", id });
  if (workspace) releaseWorkspaceDirtyStore(workspace.path);
  emitStateChanged({ parentWorkspaceId: id });
}

/**
 * All nestedWorkspaces tagged with `metadata.parentWorkspaceId === parentWorkspaceId`. This is the
 * canonical workspace-membership predicate for core operations (close sweeps,
 * reclaim, reconcile). Extension-layer consumers that need a CWD-prefix
 * fallback for unclaimed nestedWorkspaces should compose with this result.
 */
export function getWorktreeWorkspaces(
  parentWorkspaceId: string,
): NestedWorkspace[] {
  return get(nestedWorkspaces).filter(
    (w) => wsMeta(w).parentWorkspaceId === parentWorkspaceId,
  );
}

/**
 * Close every workspace tagged with `metadata.parentWorkspaceId === id`. Deletion
 * ripples through the nestedWorkspaces store, so we resolve each workspace by
 * id after recollecting the list. Dashboard nestedWorkspaces for the workspace
 * match the same predicate and are closed here too; callers should not
 * close the dashboard separately.
 */
function closeNestedWorkspaceById(wsId: string): void {
  const idx = get(nestedWorkspaces).findIndex((w) => w.id === wsId);
  if (idx >= 0) closeNestedWorkspace(idx);
}

export function closeNestedWorkspacesInWorkspace(id: string): void {
  for (const ws of getWorktreeWorkspaces(id)) closeNestedWorkspaceById(ws.id);
}

/**
 * Appends `workspaceId` to `parentWorkspaceId`'s nestedWorkspaceIds if not already
 * present. No-op when the workspace is missing (e.g. was just deleted).
 * Returns true when a change was persisted.
 *
 * Enforces the single-primary invariant: throws if adding a non-worktree,
 * non-dashboard workspace to a workspace that already has a primaryNestedWorkspaceId.
 */
export function addNestedWorkspaceToWorkspace(
  parentWorkspaceId: string,
  workspaceId: string,
): boolean {
  const workspaces = getWorkspaces();
  const workspace = workspaces.find((g) => g.id === parentWorkspaceId);
  if (!workspace) return false;
  if (workspace.nestedWorkspaceIds.includes(workspaceId)) return false;

  // Enforce single-primary invariant.
  const incomingWs = get(nestedWorkspaces).find((w) => w.id === workspaceId);
  if (incomingWs) {
    const md = wsMeta(incomingWs);
    if (
      !md.worktreePath &&
      !md.isDashboard &&
      workspace.primaryNestedWorkspaceId
    ) {
      throw new Error(
        `Workspace "${parentWorkspaceId}" already has a primary workspace "${workspace.primaryNestedWorkspaceId}". ` +
          `Cannot add a second non-worktree workspace "${workspaceId}".`,
      );
    }
  }

  const next = workspaces.map((g) => {
    if (g.id === parentWorkspaceId) {
      return {
        ...g,
        nestedWorkspaceIds: [...g.nestedWorkspaceIds, workspaceId],
      };
    }
    return g;
  });
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId });
  return true;
}

/**
 * Inserts `workspaceId` into `parentWorkspaceId`'s nestedWorkspaceIds at `positionInWorkspace`.
 * No-op when the workspace is missing or already contains the workspace.
 * Returns true when a change was persisted.
 */
export function insertNestedWorkspaceIntoWorkspace(
  parentWorkspaceId: string,
  workspaceId: string,
  positionInWorkspace: number,
): boolean {
  const workspaces = getWorkspaces();
  let changed = false;
  const next = workspaces.map((g) => {
    if (g.id !== parentWorkspaceId) return g;
    if (g.nestedWorkspaceIds.includes(workspaceId)) return g;
    changed = true;
    const ids = [...g.nestedWorkspaceIds];
    ids.splice(
      Math.max(0, Math.min(ids.length, positionInWorkspace)),
      0,
      workspaceId,
    );
    return { ...g, nestedWorkspaceIds: ids };
  });
  if (!changed) return false;
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId });
  return true;
}

/**
 * Strips `workspaceId` from every workspace's nestedWorkspaceIds. Used when a
 * workspace is closed — the workspace membership is inferred from workspace
 * metadata, so removing from all is cheap and idempotent.
 */
export function removeNestedWorkspaceFromAllWorkspaces(
  workspaceId: string,
): void {
  const next = getWorkspaces().map((g) => ({
    ...g,
    nestedWorkspaceIds: g.nestedWorkspaceIds.filter((id) => id !== workspaceId),
  }));
  setWorkspaces(next);
  emitStateChanged({});
}

/**
 * Path of the markdown file backing a workspace's Dashboard. Lives inside
 * the workspace's own `.gnar-term/` directory so multi-machine sync /
 * checkout follows the workspace itself.
 */
export function workspaceDashboardPath(workspacePath: string): string {
  return `${workspacePath.replace(/\/+$/, "")}/.gnar-term/project-dashboard.md`;
}

function buildWorkspaceDashboardMarkdown(workspace: Workspace): string {
  // The Workspace Dashboard is the generic, agent-agnostic landing page for
  // a Workspace. It surfaces GitHub work-tracker context — open
  // issues + open PRs — side by side, as a passive read-only browse
  // panel. Spawn-on-issue lives on the per-workspace Agentic Dashboard tile
  // (which mounts the same `gnar:issues` widget without `displayOnly`).
  //
  // `gnar:columns`, `gnar:issues`, and `gnar:prs` are all registered by
  // the agentic extension. When that extension is disabled the markdown
  // previewer renders unknown widgets as a fallback, so the Dashboard
  // degrades gracefully for users who don't want agents.
  return `# ${workspace.name}

Project at \`${workspace.path}\`.

\`\`\`gnar:workspaces
\`\`\`

\`\`\`gnar:columns
children:
  - name: issues
    config:
      state: open
      displayOnly: true
  - name: prs
    config:
      state: open
\`\`\`
`;
}

/**
 * Write the Workspace Overview Dashboard markdown template to `path`.
 *
 * `force: true` overwrites any existing file — used by the
 * "Regenerate" action in Workspace Settings to refresh user-stale
 * templates after the seeded layout changes. The default skips the
 * write when a file is already present so first-create on an existing
 * workspace never trampling user customizations.
 */
async function writeWorkspaceDashboardTemplate(
  workspace: Workspace,
  path: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!options.force) {
    const exists = await invoke<boolean>("file_exists", { path }).catch(
      () => false,
    );
    if (exists) return;
  }
  const dir = path.replace(/\/[^/]+$/, "");
  await invoke("ensure_dir", { path: dir });
  await invoke("write_file", {
    path,
    content: buildWorkspaceDashboardMarkdown(workspace),
  });
}

/**
 * Public regenerate hook for the Workspace Overview Dashboard
 * contribution. Force-rewrites the markdown at `workspaceDashboardPath`;
 * the preview surface watching that file picks up the change without
 * needing the workspace to be closed/recreated.
 */
export async function regenerateWorkspaceDashboardTemplate(
  workspace: Workspace,
): Promise<void> {
  await writeWorkspaceDashboardTemplate(
    workspace,
    workspaceDashboardPath(workspace.path),
    {
      force: true,
    },
  );
}

/**
 * Remove the legacy `## Active Agents` section (heading + adjacent
 * `gnar:agent-list` fenced code block) from workspace Overview markdown.
 *
 * Older templates emitted this section into every workspace's
 * `project-dashboard.md`; once the Agentic Dashboard became its own
 * tile the widget's presence on the Overview was redundant. The
 * template stopped emitting it, but existing user files kept the
 * stale block. This runs once per reconciliation pass — idempotent by
 * design (match-or-skip, never appends).
 *
 * The matcher is strict: heading "## Active Agents" followed by
 * whitespace and a `gnar:agent-list` fenced code block. If the user
 * has added custom content under the heading, no match occurs and the
 * file is left alone.
 */
function stripActiveAgentsSection(markdown: string): string | null {
  const pattern =
    /\n*##\s+Active Agents\s*\n+```gnar:agent-list\n[^`]*```\s*\n?/;
  if (!pattern.test(markdown)) return null;
  return markdown.replace(pattern, "\n");
}

async function scrubWorkspaceDashboardActiveAgents(
  path: string,
): Promise<void> {
  try {
    const exists = await invoke<boolean>("file_exists", { path }).catch(
      () => false,
    );
    if (!exists) return;
    const content = await invoke<string>("read_file", { path });
    const next = stripActiveAgentsSection(content);
    if (next === null) return;
    await invoke("write_file", { path, content: next });
  } catch (err) {
    console.warn(
      `[workspace-groups] Failed to scrub Active Agents from "${path}":`,
      err,
    );
  }
}

export async function migrateWorkspaceDashboardWidgets(
  workspace: Workspace,
  path: string,
): Promise<void> {
  try {
    const exists = await invoke<boolean>("file_exists", { path }).catch(
      () => false,
    );
    if (!exists) return;
    const content = await invoke<string>("read_file", { path });
    if (content.includes("gnar:workspaces")) return;
    const marker = "```gnar:columns";
    const insert = "```gnar:workspaces\n```\n\n";
    const migrated = content.includes(marker)
      ? content.replace(marker, insert + marker)
      : insert + content;
    await invoke("write_file", { path, content: migrated });
  } catch (err) {
    console.warn(
      `[workspace-groups] Failed to migrate nestedWorkspaces widget into "${path}":`,
      err,
    );
  }
}

function createDashboardWorkspaceFromDef(
  workspace: Workspace,
  name: string,
  contribId: string,
  surfaces: SurfaceDef[],
): Promise<string> {
  return createNestedWorkspaceFromDef({
    name,
    layout: { pane: { surfaces } },
    metadata: {
      isDashboard: true,
      parentWorkspaceId: workspace.id,
      dashboardContributionId: contribId,
    },
  });
}

/**
 * Create the Dashboard workspace for a workspace: a constrained workspace
 * (metadata.isDashboard = true) hosting a single Live Preview of the
 * workspace's markdown file. Returns the new workspace id so the workspace
 * record can link to it.
 */
export async function createWorkspaceDashboardNestedWorkspace(
  workspace: Workspace,
): Promise<string> {
  const path = workspaceDashboardPath(workspace.path);
  try {
    await writeWorkspaceDashboardTemplate(workspace, path);
  } catch {
    // Best-effort write — the workspace can still be created; the
    // preview surface will surface the backing-file error if relevant.
  }
  return createDashboardWorkspaceFromDef(workspace, "Dashboard", "group", [
    { type: "preview", path, name: workspace.name, focus: true },
  ]);
}

/**
 * Backfill `metadata.dashboardContributionId` on legacy dashboard
 * nestedWorkspaces that were created before the field existed. Without the
 * stamp, `hasDashboardWorkspace` (strict-match) misses the workspace
 * and `provisionAutoDashboardsForWorkspace` spawns a duplicate every
 * startup.
 *
 * Inference rules (preview-surface path-based):
 *   - backs the workspace's `project-dashboard.md` → `"group"`
 *   - backs the workspace's `.gnar-term/agentic-dashboard.md` → `"agentic"`
 *
 * Runs in a single nestedWorkspaces.update so subscribers see one state
 * transition. Idempotent: any workspace whose stamp is already set is
 * left alone.
 */
function backfillDashboardContributionIds(): void {
  const workspaces = getWorkspaces();
  if (workspaces.length === 0) return;
  const workspaceById = new Map<string, Workspace>();
  for (const g of workspaces) workspaceById.set(g.id, g);

  let mutated = false;
  nestedWorkspaces.update((list) => {
    const next = list.map((ws) => {
      const md = wsMeta(ws);
      if (md.isDashboard !== true) return ws;
      if (typeof md.dashboardContributionId === "string") return ws;
      const parentWorkspaceId = md.parentWorkspaceId;
      if (typeof parentWorkspaceId !== "string") return ws;
      const workspace = workspaceById.get(parentWorkspaceId);
      if (!workspace) return ws;

      const previewPaths = getAllPanes(ws.splitRoot)
        .flatMap((p) => p.surfaces)
        .filter(
          (s): s is { kind: "preview"; path: string } & typeof s =>
            s.kind === "preview",
        )
        .map((s) => s.path);

      let inferred: string | null = null;
      const workspacePath = workspaceDashboardPath(workspace.path);
      const agenticPath = `${workspace.path.replace(/\/+$/, "")}/.gnar-term/agentic-dashboard.md`;
      if (previewPaths.includes(workspacePath)) inferred = "group";
      else if (previewPaths.includes(agenticPath)) inferred = "agentic";
      if (!inferred) return ws;

      mutated = true;
      return {
        ...ws,
        metadata: {
          ...(ws.metadata ?? {}),
          dashboardContributionId: inferred,
        },
      };
    });
    return mutated ? next : list;
  });
}

/**
 * Materialize the Settings dashboard workspace for a workspace — a
 * constrained dashboard (metadata.isDashboard = true,
 * dashboardContributionId = "settings") whose body PaneView renders as
 * the shared `<WorkspaceDashboardSettings>` component. The workspace carries
 * a single empty preview surface so it satisfies the workspace schema;
 * PaneView intercepts and replaces the surface render for settings
 * contributions.
 */
export function createSettingsDashboardWorkspace(
  workspace: Workspace,
): Promise<string> {
  return createDashboardWorkspaceFromDef(workspace, "Settings", "settings", []);
}

/**
 * Canonical predicate for workspace dashboard membership.
 *
 * - No `contribId` → matches any dashboard workspace for the workspace.
 * - `contribId` provided, `allowLegacyUndefined = false` → strict exact
 *   match (use for lookups where the contribution is known).
 * - `contribId` provided, `allowLegacyUndefined = true` → matches exact
 *   OR a workspace whose `dashboardContributionId` is still `undefined`
 *   (pre-stamp legacy records). Use for the workspace-overview reconcile pass.
 */
export function isDashboardWorkspace(
  ws: { metadata?: NestedWorkspaceMetadata },
  parentWorkspaceId: string,
  contribId?: string,
  allowLegacyUndefined = false,
): boolean {
  const md = ws.metadata;
  if (!md) return false;
  if (md.isDashboard !== true) return false;
  if (md.parentWorkspaceId !== parentWorkspaceId) return false;
  if (contribId === undefined) return true;
  const contribution = md.dashboardContributionId;
  if (allowLegacyUndefined) {
    return contribution === undefined || contribution === contribId;
  }
  return contribution === contribId;
}

export function findDashboardWorkspace(
  parentWorkspaceId: string,
  contribId: string,
) {
  return get(nestedWorkspaces).find((w) =>
    isDashboardWorkspace(w, parentWorkspaceId, contribId),
  );
}

/** True when a workspace exists for the given workspace + contribution pair. */
export function hasDashboardWorkspace(
  parentWorkspaceId: string,
  contribId: string,
): boolean {
  return get(nestedWorkspaces).some((w) =>
    isDashboardWorkspace(w, parentWorkspaceId, contribId),
  );
}

/**
 * Provision every registered `autoProvision` dashboard contribution for
 * `workspace`. Called after a workspace is created and on startup
 * reconciliation so auto-provision contributions (settings, agentic)
 * always have their workspace available. Idempotent — a contribution
 * already backed by a workspace is skipped.
 */
export async function provisionAutoDashboardsForWorkspace(
  workspace: Workspace,
): Promise<void> {
  for (const c of getDashboardContributions()) {
    if (!c.autoProvision) continue;
    if (hasDashboardWorkspace(workspace.id, c.id)) continue;
    try {
      await c.create(workspace);
    } catch (err) {
      console.warn(
        `[workspace-groups] auto-provision failed for "${c.id}":`,
        err,
      );
    }
  }
}

/**
 * Close every workspace whose `dashboardContributionId` belongs to a
 * contribution registered by `source` and marked autoProvision. Used on
 * extension deactivate so auto-provisioned dashboards disappear
 * alongside their owning extension.
 */
export function closeAutoDashboardsBySource(source: string): void {
  const autoIds = new Set(
    getDashboardContributions()
      .filter((c) => c.source === source && c.autoProvision)
      .map((c) => c.id),
  );
  if (autoIds.size === 0) return;
  const matchIds = get(nestedWorkspaces)
    .filter((w) => {
      const md = wsMeta(w);
      if (md.isDashboard !== true) return false;
      const contrib = md.dashboardContributionId;
      return typeof contrib === "string" && autoIds.has(contrib);
    })
    .map((w) => w.id);
  for (const wsId of matchIds) closeNestedWorkspaceById(wsId);
}

/**
 * Locate the dashboard workspace for `parentWorkspaceId` + `contributionId` and
 * close it. Used by the Settings toggle UI and by MCP to remove a
 * dashboard contribution from a workspace.
 */
export function closeDashboardForWorkspace(
  parentWorkspaceId: string,
  contributionId: string,
): boolean {
  const match = findDashboardWorkspace(parentWorkspaceId, contributionId);
  if (!match) return false;
  const contribution = getDashboardContribution(contributionId);
  if (contribution?.autoProvision) return false;
  closeNestedWorkspaceById(match.id);
  return true;
}

/**
 * Switch to a workspace's Dashboard workspace. The Dashboard is created
 * eagerly on workspace creation, so this is a pure activation call.
 * Returns true on success.
 */
export function openWorkspaceDashboard(workspace: Workspace): boolean {
  const targetId = workspace.dashboardNestedWorkspaceId;
  if (!targetId) return false;
  const idx = get(nestedWorkspaces).findIndex((w) => w.id === targetId);
  if (idx < 0) return false;
  activeNestedWorkspaceIdx.set(idx);
  return true;
}

/**
 * Close the Dashboard workspace backing `workspace` if it is currently
 * open. Used during workspace deletion so the workspace disappears
 * alongside the workspace record.
 */
export async function closeWorkspaceDashboardNestedWorkspace(
  workspace: Workspace,
): Promise<void> {
  const dashboardWsId = workspace.dashboardNestedWorkspaceId;
  if (!dashboardWsId) return;
  closeNestedWorkspaceById(dashboardWsId);
}

/**
 * Called on app startup (after nestedWorkspaces are restored) — ensures every
 * workspace has exactly one Dashboard NestedWorkspace. Prior releases
 * matched the dashboard via `workspace.dashboardNestedWorkspaceId`; nested workspace
 * ids were unstable across restarts, so on every reload the lookup
 * missed and a fresh dashboard was spawned. The cleanup runs in three
 * passes:
 *
 *   1. Adopt the first workspace matching `metadata.isDashboard ===
 *      true && metadata.parentWorkspaceId === workspace.id` (with no contribution id,
 *      or an explicit `"group"` id) — rebinding the workspace's
 *      `dashboardNestedWorkspaceId` to that workspace.
 *   2. Close every extra Workspace Dashboard for the same workspace (users end
 *      up with these when pre-fix state carried duplicates).
 *   3. Only when no dashboard exists at all, create a fresh one.
 *
 * The loop is sequential because `closeNestedWorkspace` mutates the
 * nestedWorkspaces store and ripples to `$activeNestedWorkspaceIdx`.
 */
export async function reconcileWorkspaceDashboards(): Promise<void> {
  // Backfill `dashboardContributionId` on restored legacy dashboards
  // so autoProvision's strict contribId match doesn't spawn duplicates.
  // Safe to call unconditionally — idempotent, early-returns when
  // nothing is inferable.
  backfillDashboardContributionIds();

  await Promise.allSettled(
    getWorkspaces().map(async (workspace) => {
      // One-shot cleanup: strip the legacy `## Active Agents` section
      // from the workspace's Overview markdown if it's still there. Runs
      // before we materialize / rebind the dashboard workspace so the
      // first render already reflects the cleaned file.
      await scrubWorkspaceDashboardActiveAgents(
        workspaceDashboardPath(workspace.path),
      );
      await migrateWorkspaceDashboardWidgets(
        workspace,
        workspaceDashboardPath(workspace.path),
      );

      // Deduplicate every autoProvision contribution type — keeps the first
      // match, closes the rest. Previously only "group" was covered; the
      // startup race could leave duplicate "settings" or extension-owned
      // dashboards (e.g. "agentic") that are now caught here too.
      for (const c of getDashboardContributions()) {
        if (!c.autoProvision) continue;
        const dupeMatches = get(nestedWorkspaces).filter((w) =>
          isDashboardWorkspace(w, workspace.id, c.id, true),
        );
        if (dupeMatches.length <= 1) continue;
        const [, ...extras] = dupeMatches;
        for (const dup of extras) closeNestedWorkspaceById(dup.id);
      }

      // Back-fill any autoProvision contribution (including `"group"` if
      // it is still missing after the dedupe pass, plus `"settings"` and
      // extension-owned autoProvision contributions).
      try {
        await provisionAutoDashboardsForWorkspace(workspace);
        // Rebind `dashboardNestedWorkspaceId` to the current "group" overview —
        // either the one that survived dedupe or the one just provisioned.
        const overview = get(nestedWorkspaces).find((w) =>
          isDashboardWorkspace(w, workspace.id, "group", true),
        );
        if (overview && overview.id !== workspace.dashboardNestedWorkspaceId) {
          updateWorkspace(workspace.id, {
            dashboardNestedWorkspaceId: overview.id,
          });
        }
      } catch (err) {
        console.warn(
          "[workspace-groups] Dashboard reconciliation failed:",
          err,
        );
      }
    }),
  );
}

/**
 * Re-claim nestedWorkspaces tagged with `metadata.parentWorkspaceId` that belong to a
 * known workspace. Called on app startup once workspaces are loaded and
 * nestedWorkspaces are restored — restoration creates fresh workspace ids so
 * we rebuild each workspace's nestedWorkspaceIds list here.
 */
export function reclaimNestedWorkspacesAcrossWorkspaces(): void {
  const workspaces = getWorkspaces();
  const workspaceIds = new Set(workspaces.map((g) => g.id));

  // Collect workspace ids per workspace in a single pass to avoid one
  // setWorkspaces() call (and event emission) per workspace.
  const newMembers = new Map<string, string[]>();
  const toClaimIds: string[] = [];
  for (const ws of get(nestedWorkspaces)) {
    const parentWorkspaceId = wsMeta(ws).parentWorkspaceId;
    if (
      typeof parentWorkspaceId !== "string" ||
      !workspaceIds.has(parentWorkspaceId)
    )
      continue;
    const members = newMembers.get(parentWorkspaceId) ?? [];
    members.push(ws.id);
    newMembers.set(parentWorkspaceId, members);
    toClaimIds.push(ws.id);
  }

  if (newMembers.size > 0) {
    const next = workspaces.map((g) => {
      const toAdd = newMembers.get(g.id) ?? [];
      if (toAdd.length === 0) return g;
      const existing = new Set(g.nestedWorkspaceIds);
      const fresh = toAdd.filter((id) => !existing.has(id));
      return fresh.length > 0
        ? { ...g, nestedWorkspaceIds: [...g.nestedWorkspaceIds, ...fresh] }
        : g;
    });
    setWorkspaces(next);
    emitStateChanged({});
  }

  for (const wsId of toClaimIds) claimWorkspace(wsId, "core");
}

/**
 * Startup reconciliation — called after nestedWorkspaces are restored.
 *
 * Pass 1: For every workspace lacking `primaryNestedWorkspaceId`, select the first
 * member workspace that is neither a dashboard nor a worktree.
 *
 * Pass 2: Wrap every standalone workspace (no metadata.parentWorkspaceId, not a
 * dashboard) into a fresh workspace with that workspace as its primary.
 *
 * Idempotent — workspaces that already have `primaryNestedWorkspaceId` are skipped.
 */
export async function reconcilePrimaryWorkspaces(): Promise<void> {
  // Pass 1 — backfill existing workspaces.
  for (const workspace of getWorkspaces()) {
    if (workspace.primaryNestedWorkspaceId) continue;
    const members = getWorktreeWorkspaces(workspace.id);
    const primary = members.find(
      (w) => !wsMeta(w).worktreePath && !wsMeta(w).isDashboard,
    );
    if (primary) {
      updateWorkspace(workspace.id, { primaryNestedWorkspaceId: primary.id });
    }
    // Groups with no eligible primary are left without one — the next
    // workspace creation flow will set it.
  }

  // Pass 2 — wrap standalone nestedWorkspaces.
  const knownWorkspaceIds = new Set(getWorkspaces().map((g) => g.id));
  // Snapshot before we start mutating so the loop is stable.
  const snapshot = get(nestedWorkspaces);
  const usedColors = getWorkspaces().map((g) => g.color);

  for (const ws of snapshot) {
    const md = wsMeta(ws);
    if (md.parentWorkspaceId && knownWorkspaceIds.has(md.parentWorkspaceId))
      continue;
    if (md.isDashboard) continue;
    // Orphan worktree nestedWorkspaces (workspace deleted, worktreePath still set) are
    // not primary candidates — skip them rather than wrapping them alone.
    if (md.worktreePath) continue;

    const colorIdx = usedColors.length % GROUP_COLOR_SLOTS.length;
    const color: string = GROUP_COLOR_SLOTS[colorIdx] ?? GROUP_COLOR_SLOTS[0];
    usedColors.push(color);

    const id = crypto.randomUUID();
    const workspace: Workspace = {
      id,
      name: ws.name,
      path: ((md as Record<string, unknown>).cwd as string) ?? "",
      color,
      nestedWorkspaceIds: [ws.id],
      primaryNestedWorkspaceId: ws.id,
      isGit: false,
      createdAt: new Date().toISOString(),
    };

    // Stamp the workspace with its new workspace and persist so the parentWorkspaceId
    // survives a restart — without this the workspace comes back as
    // standalone, fails the claim check, and gets wrapped again.
    nestedWorkspaces.update((list) =>
      list.map((w) =>
        w.id === ws.id
          ? { ...w, metadata: { ...(w.metadata ?? {}), parentWorkspaceId: id } }
          : w,
      ),
    );
    schedulePersist();
    addWorkspace(workspace);
    // onWorkspaceCreated already fired before reconcile runs, so claim here.
    claimWorkspace(ws.id, "core");
    knownWorkspaceIds.add(id);
  }

  // Pass 3 — claim all nestedWorkspaces that have metadata.parentWorkspaceId pointing to
  // valid workspaces. This rehydrates the in-memory claim registry from
  // persisted metadata on restart.
  const validWorkspaceIds = new Set(getWorkspaces().map((g) => g.id));
  for (const ws of get(nestedWorkspaces)) {
    const md = wsMeta(ws);
    if (md.parentWorkspaceId && validWorkspaceIds.has(md.parentWorkspaceId)) {
      claimWorkspace(ws.id, "core");
    }
  }
}

/**
 * When a primary workspace is deleted, recreate it to maintain the invariant
 * that every workspace has exactly one non-worktree workspace.
 */
export function setupPrimaryWorkspaceAutoRecreation(): void {
  eventBus.on("workspace:closed", async (event) => {
    if (event.type !== "workspace:closed") return;
    const closedId = event.id;
    const workspace = getWorkspaces().find(
      (g) => g.primaryNestedWorkspaceId === closedId,
    );
    if (!workspace) return; // Not a primary workspace

    // Recreate the primary workspace with the same name
    const newWsId = await createNestedWorkspaceFromDef({
      name: workspace.name,
      cwd: workspace.path,
      metadata: { parentWorkspaceId: workspace.id },
    });
    if (newWsId) {
      // Update the workspace's primary to the new workspace
      updateWorkspace(workspace.id, { primaryNestedWorkspaceId: newWsId });
      claimWorkspace(newWsId, "core");
    }
  });
}

export {
  getWorkspace,
  getWorkspaces,
  setActiveWorkspaceId,
  unclaimWorkspace,
  claimWorkspace,
};
