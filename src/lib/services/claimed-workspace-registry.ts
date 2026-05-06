/**
 * Claimed Workspace ID derivation + sidebar mirror helpers.
 *
 * A workspace is "claimed" iff it has a `rootWorkspaceId` — that is,
 * it lives inside another Workspace and should not appear at the
 * sidebar root. The registry that used to track claims with a source
 * extension id is gone (Stage 10): the unified Workspace already carries
 * `rootWorkspaceId` as a top-level field, so claim status is derived,
 * not tracked.
 *
 * `claimWorkspace` / `unclaimWorkspace` remain as small mirror helpers
 * that keep the persisted `rootRowOrder` consistent with the live
 * Workspace shape — call sites that flip `rootWorkspaceId` use them
 * to drop or restore the corresponding root row.
 */
import { derived, type Readable } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { removeRootRow, appendRootRow } from "../stores/root-row-order";

/** Readable set of workspace IDs that belong to a root Workspace (i.e. are Branches or Dashboards). */
export const claimedWorkspaceIds: Readable<Set<string>> = derived(
  workspaces,
  ($workspaces) => {
    const ids = new Set<string>();
    for (const w of $workspaces) {
      if (typeof w.rootWorkspaceId === "string") ids.add(w.id);
    }
    return ids;
  },
);

/**
 * Mirror a workspace becoming claimed: drop it from the root-row list.
 * The `source` parameter is accepted for backward compatibility with the
 * pre-Stage-10 API but is no longer recorded anywhere.
 */
export function claimWorkspace(workspaceId: string, _source?: string): void {
  removeRootRow({ kind: "child-workspace", id: workspaceId });
}

/** Mirror a workspace becoming unclaimed: append it back to the root-row list. */
export function unclaimWorkspace(workspaceId: string): void {
  appendRootRow({ kind: "child-workspace", id: workspaceId });
}

/**
 * Pre-Stage-10 hook for "deactivate extension X — drop every claim it
 * holds". With the registry gone, no per-source tracking exists; this
 * function is a no-op preserved only because `extension-constants` wires
 * it into `REGISTRY_CLEANUP_FNS`.
 */
export function unclaimBySource(_source: string): void {
  // No-op: claim is now derived from Workspace.rootWorkspaceId.
}

/** Test hook — no-op (no internal state remains). */
export function resetClaimedWorkspaces(): void {
  // No-op: claimedWorkspaceIds is derived from the workspaces store.
}
