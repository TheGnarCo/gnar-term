/**
 * branch-lifecycle-actions — explicit user-driven transitions.
 *
 * Per ontology: drag-across-columns / direct store mutation is forbidden.
 * Only actions like `markAbandoned` may trigger state transitions, and
 * they do so by mutating canonical inputs (closing the workspace), never
 * by writing to the derived store.
 */

import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { confirmAndCloseWorkspace } from "./worktree-service";
import type { Workspace } from "../types";
import { _getBranchDescriptor } from "./branch-lifecycle-store";

/**
 * Mark a branch as abandoned by closing the associated workspace via
 * `confirmAndCloseWorkspace`. The lifecycle becomes `abandoned` only when
 * the close takes effect (the workspace — and therefore the pane and
 * agent state — disappear from the registry).
 *
 * No-op when the branch is unknown, has no `workspaceId`, or its workspace
 * has already been removed from the store.
 */
export async function markAbandoned(branchId: string): Promise<void> {
  const desc = _getBranchDescriptor(branchId);
  if (!desc?.workspaceId) return;

  const allWorkspaces = get(workspaces) as Workspace[];
  const idx = allWorkspaces.findIndex((w) => w.id === desc.workspaceId);
  const ws = allWorkspaces[idx];
  if (idx < 0 || !ws) return;

  await confirmAndCloseWorkspace(ws, idx);
}
