/**
 * Pre-Stage-9 → Stage-10 data migration.
 *
 * Folds the legacy `WorkspaceRecord` list (`AppState.parentWorkspaces`)
 * into the unified `WorkspaceDef[]` (`AppState.workspaces`):
 *
 *  - Each `WorkspaceRecord P` and its legacy primary BranchedWorkspace
 *    `B` (the one whose id matches `P.primaryBranchedWorkspaceId`)
 *    collapse into a single Workspace using `P.id`. The merged record
 *    carries `B.layout` + `B.extensionData` plus `P`'s Workspace-level
 *    fields (path, color, isGit, createdAt, etc.).
 *  - Existing Branches/Dashboards keep their `rootWorkspaceId === P.id`
 *    references — they continue to point at the merged Workspace.
 *  - The legacy `primaryBranchedWorkspaceId` notion is dropped: every
 *    Workspace is its own Root, branches are siblings.
 *  - `lastActiveBranchedWorkspaceId` pointing at the absorbed primary is
 *    dropped; pointing at any other Branch is preserved.
 *  - Active id is redirected: an absorbed primary's id → Workspace id.
 *
 * Pure (state in, state out) so it can be unit-tested without I/O.
 */
import type { AppState, WorkspaceDef, LayoutNode } from "../config";
import type { WorkspaceRecord } from "../stores/workspace";

/**
 * Legacy WorkspaceRecord shape (pre-Stage-10): Records carried a
 * `primaryBranchedWorkspaceId` pointing at the runtime BranchedWorkspace
 * that owned the Record's tab surface. Stage 10 dropped this field —
 * the Record's id and the runtime Root id are unified — but the
 * migration still needs to read the legacy persisted shape to fold
 * absorbed primaries into the merged Workspace.
 */
type LegacyWorkspaceRecord = WorkspaceRecord & {
  primaryBranchedWorkspaceId?: string;
};

const EMPTY_LAYOUT: LayoutNode = { pane: { surfaces: [] } };

export function migrateLegacyWorkspaces(state: AppState): AppState {
  const parents = (state.parentWorkspaces ?? []) as LegacyWorkspaceRecord[];
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
  parents: LegacyWorkspaceRecord[],
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
