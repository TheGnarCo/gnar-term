/**
 * Pre-Stage-9 → Stage-9 data migration.
 *
 * Folds the legacy `WorkspaceRecord` list (`AppState.parentWorkspaces`)
 * into the unified `WorkspaceDef[]` (`AppState.workspaces`):
 *
 *  - Each `WorkspaceRecord P` and its primary BranchedWorkspace `B`
 *    (the one whose id matches `P.primaryBranchedWorkspaceId`) collapse
 *    into a single Workspace using `P.id`. The merged record carries
 *    `B.layout` + `B.extensionData` plus `P`'s Workspace-level fields
 *    (path, color, isGit, createdAt, etc.).
 *  - Existing Branches/Dashboards keep their `parentWorkspaceId === P.id`
 *    references — they continue to point at the merged Workspace.
 *  - `primaryBranchedWorkspaceId` is dropped (the Workspace IS the
 *    default working area).
 *  - `lastActiveBranchedWorkspaceId` pointing at the absorbed primary is
 *    dropped; pointing at any other Branch is preserved.
 *  - Active id is redirected: an absorbed primary's id → Workspace id.
 *
 * Pure (state in, state out) so it can be unit-tested without I/O.
 */
import type { AppState, WorkspaceDef, LayoutNode } from "../config";
import type { WorkspaceRecord } from "../stores/workspace";

const EMPTY_LAYOUT: LayoutNode = { pane: { surfaces: [] } };

export function migrateLegacyWorkspaces(state: AppState): AppState {
  const parents = state.parentWorkspaces ?? [];
  if (parents.length === 0) return state;

  const wsdef = state.workspaces ?? [];
  const wsById = new Map(wsdef.map((w) => [w.id, w] as const));

  const absorbedIds = new Set<string>();
  const merged: WorkspaceDef[] = [];

  for (const p of parents) {
    const primaryId = p.primaryBranchedWorkspaceId;
    const primary = primaryId ? wsById.get(primaryId) : undefined;
    if (primary) absorbedIds.add(primary.id);

    const recordDef: WorkspaceDef = {
      id: p.id,
      name: p.name,
      layout: primary?.layout ?? EMPTY_LAYOUT,
    };
    if (p.path !== undefined) recordDef.path = p.path;
    if (p.color !== undefined) recordDef.color = p.color;
    if (p.isGit !== undefined) recordDef.isGit = p.isGit;
    if (p.createdAt !== undefined) recordDef.createdAt = p.createdAt;
    if (p.autoRunRestoreCommands !== undefined) {
      recordDef.autoRunRestoreCommands = p.autoRunRestoreCommands;
    }
    if (p.locked) recordDef.locked = p.locked;
    if (p.dashboardWorkspaceId) {
      recordDef.dashboardWorkspaceId = p.dashboardWorkspaceId;
    }
    if (
      p.lastActiveBranchedWorkspaceId &&
      p.lastActiveBranchedWorkspaceId !== primaryId
    ) {
      recordDef.lastActiveBranchedWorkspaceId = p.lastActiveBranchedWorkspaceId;
    }
    if (primary?.extensionData) {
      recordDef.extensionData = primary.extensionData;
    }

    merged.push(recordDef);
  }

  const others = wsdef.filter((w) => !absorbedIds.has(w.id));

  return {
    ...state,
    workspaces: [...merged, ...others],
    activeWorkspaceId: pickActiveId(state, absorbedIds, parents),
    parentWorkspaces: undefined,
    activeParentWorkspaceId: undefined,
  };
}

function pickActiveId(
  state: AppState,
  absorbedIds: Set<string>,
  parents: WorkspaceRecord[],
): string | undefined {
  const wsActive = state.activeWorkspaceId;
  if (wsActive && !absorbedIds.has(wsActive)) return wsActive;
  if (wsActive && absorbedIds.has(wsActive)) {
    const owner = parents.find(
      (p) => p.primaryBranchedWorkspaceId === wsActive,
    );
    if (owner) return owner.id;
  }
  return state.activeParentWorkspaceId;
}
