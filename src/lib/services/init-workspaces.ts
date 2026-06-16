/**
 * Workspaces boot path.
 *
 * Wires the persisted session back to life on launch:
 *   1. loadState           — read state.json (legacy keys normalized)
 *   2. restore sidebar      — sidebarVisible + groupCollapsedById, BEFORE the
 *                             persist subscriptions attach (skip-first-emission)
 *   3. restoreWorkspaces    — hydrate workspaces from CLI args / state / config
 *   4. seed workspaceOrder  — bootstrap row order from persisted order, anchored
 *                             on the live anchors
 *   5. reclaimGroupMembers  — rebuild member arrays from anchorWorkspaceId tags
 *   6. reconcile            — materialize a sidebar row for every anchor
 *   7. attach persisters    — sidebar state writes back on change
 *
 * Dashboards / archive / ssh / git-recheck registration are out of scope and
 * intentionally absent.
 */
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { loadState } from "../config";
import {
  bootstrapWorkspaceOrder,
  type WorkspaceRow,
} from "../stores/workspace-order";
import { isWorkspaceMember, type Workspace } from "../types";
import {
  reclaimGroupMembers,
  reconcilePrimaryWorkspaces,
} from "./workspace-service";
import {
  restoreWorkspaces,
  type CliArgs,
} from "./restore-workspaces";
import {
  restoreSidebarVisible,
  restoreGroupCollapsed,
  persistSidebarVisibleChanges,
  persistGroupCollapsedChanges,
} from "./sidebar-persistence-service";
import type { GnarTermConfig } from "../config";

/** Unsubscribe handles for the sidebar-state persisters (test teardown). */
let _sidebarUnsubs: Array<() => void> = [];

export async function initWorkspaces(
  cliArgs: CliArgs,
  config: GnarTermConfig,
): Promise<void> {
  // 1 + 2. Load persisted state, then restore sidebar BEFORE subscribing so
  // the just-restored values aren't round-tripped back to disk.
  const state = await loadState();
  restoreSidebarVisible(state);
  restoreGroupCollapsed(state);

  // 3. Hydrate workspaces (CLI args → state.json → autoload → auto-default).
  await restoreWorkspaces(cliArgs, config);

  // 4. Seed the row order. Only anchors get rows; bootstrap preserves the
  // persisted order where the referent still exists and appends new anchors.
  const currentRows: WorkspaceRow[] = get(workspaces)
    .filter((w: Workspace) => !isWorkspaceMember(w))
    .map((w) => ({ kind: "workspace", id: w.id }));
  const persistedRows: WorkspaceRow[] = (state.workspaceOrder ?? []).map(
    (r) => ({ kind: r.kind, id: r.id }),
  );
  bootstrapWorkspaceOrder(currentRows, persistedRows);

  // 5. Rebuild member ordering arrays from the canonical anchor tags.
  reclaimGroupMembers();

  // 6. Ensure every anchor owns a sidebar row.
  reconcilePrimaryWorkspaces();

  // 7. Attach the sidebar-state persisters (after restore — see above).
  _sidebarUnsubs = [
    persistSidebarVisibleChanges(),
    persistGroupCollapsedChanges(),
  ];
}

/** Detach the sidebar-state persisters. Test teardown / window teardown. */
export function teardownWorkspaceInit(): void {
  for (const unsub of _sidebarUnsubs) unsub();
  _sidebarUnsubs = [];
}
