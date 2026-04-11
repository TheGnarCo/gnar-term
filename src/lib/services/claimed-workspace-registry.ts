/**
 * Claimed Workspace Registry
 *
 * Extensions (e.g., project-scope) "claim" workspace IDs so they appear
 * in the extension's own section instead of the main Workspaces block.
 * PrimarySidebar reads this store to filter the main list.
 */
import { writable, derived, type Readable } from "svelte/store";

const claimed = writable<Set<string>>(new Set());

/** Readable set of workspace IDs claimed by extensions. */
export const claimedWorkspaceIds: Readable<Set<string>> = derived(
  claimed,
  ($c) => $c,
);

export function claimWorkspace(workspaceId: string): void {
  claimed.update((s) => {
    const next = new Set(s);
    next.add(workspaceId);
    return next;
  });
}

export function unclaimWorkspace(workspaceId: string): void {
  claimed.update((s) => {
    const next = new Set(s);
    next.delete(workspaceId);
    return next;
  });
}

export function resetClaimedWorkspaces(): void {
  claimed.set(new Set());
}
