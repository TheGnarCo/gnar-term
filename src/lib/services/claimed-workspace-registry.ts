/**
 * Claimed Workspace Registry
 *
 * Extensions "claim" workspace IDs so they appear in the extension's
 * own sidebar section instead of the main Workspaces block.
 * PrimarySidebar reads this store to filter the main list.
 *
 * Each claim tracks its source extension for cleanup on deactivation.
 */
import { writable, derived, type Readable } from "svelte/store";

// Internal store: maps workspaceId → source extension id
const claimed = writable<Map<string, string>>(new Map());

/** Readable set of workspace IDs claimed by extensions. */
export const claimedWorkspaceIds: Readable<Set<string>> = derived(
  claimed,
  ($c) => new Set($c.keys()),
);

export function claimWorkspace(workspaceId: string, source: string): void {
  claimed.update((m) => {
    const next = new Map(m);
    next.set(workspaceId, source);
    return next;
  });
}

export function unclaimWorkspace(workspaceId: string): void {
  claimed.update((m) => {
    const next = new Map(m);
    next.delete(workspaceId);
    return next;
  });
}

/** Unclaim all workspaces owned by a given source extension. */
export function unclaimBySource(source: string): void {
  claimed.update((m) => {
    const next = new Map(m);
    for (const [wsId, src] of next) {
      if (src === source) next.delete(wsId);
    }
    return next;
  });
}

export function resetClaimedWorkspaces(): void {
  claimed.set(new Map());
}
