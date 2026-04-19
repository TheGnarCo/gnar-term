/**
 * Claimed Workspace Registry
 *
 * Extensions "claim" workspace IDs so they appear in the extension's
 * own sidebar section instead of the main Workspaces block.
 * PrimarySidebar reads this store to filter the main list.
 *
 * Each claim tracks its source extension for cleanup on deactivation.
 */
import { derived, type Readable } from "svelte/store";
import { createRegistry } from "./create-registry";
import { removeRootRow, appendRootRow } from "../stores/root-row-order";

interface Claim {
  id: string; // workspaceId — serves as registry identity
  source: string; // extension id that claimed the workspace
}

const registry = createRegistry<Claim>();

/** Readable set of workspace IDs claimed by extensions. */
export const claimedWorkspaceIds: Readable<Set<string>> = derived(
  registry.store,
  ($claims) => new Set($claims.map((c) => c.id)),
);

export function claimWorkspace(workspaceId: string, source: string): void {
  registry.register({ id: workspaceId, source });
  // A claimed workspace is hosted inside its owner (e.g. a project
  // block), so it must disappear from the root-row list. No-op if it
  // wasn't there.
  removeRootRow({ kind: "workspace", id: workspaceId });
}

export function unclaimWorkspace(workspaceId: string): void {
  registry.unregister(workspaceId);
  // Workspace is back at the root — restore it to the root-row list
  // (append to the end matches the legacy behavior for fresh workspaces).
  appendRootRow({ kind: "workspace", id: workspaceId });
}

/** Unclaim all workspaces owned by a given source extension. */
export function unclaimBySource(source: string): void {
  // Collect ids before unregistering so we can mirror each into the
  // root-row list (no way to get them back once registry.unregisterBySource
  // wipes them).
  const ids: string[] = [];
  const unsub = registry.store.subscribe((claims) => {
    for (const c of claims) if (c.source === source) ids.push(c.id);
  });
  unsub();
  registry.unregisterBySource(source);
  for (const id of ids) appendRootRow({ kind: "workspace", id });
}

export const resetClaimedWorkspaces = registry.reset;
