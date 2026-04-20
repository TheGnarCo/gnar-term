/**
 * Child-row contributor registry — lets one extension contribute child
 * rows to another extension's parent rows without the parent extension
 * needing to know who's contributing.
 *
 * Concrete uses:
 *   - agentic-orchestrator contributes dashboard rows under
 *     project-scope's project rows (parentType: "project")
 *   - agentic-orchestrator contributes worktree workspace rows under
 *     its own dashboard rows (parentType: "dashboard")
 *
 * Each contributor returns child row descriptors `{ kind, id }` for a
 * given parent id; the parent renderer iterates contributed rows and
 * dispatches each through the existing root-row-renderer-registry by
 * kind.
 *
 * Multiple contributors can target the same parentType — their results
 * concatenate in registration order.
 */
import { writable, get, type Readable } from "svelte/store";

/** A row descriptor returned by a contributor. */
export interface ContributedChildRow {
  /** Row kind — must match an entry in the root-row-renderer registry. */
  kind: string;
  /** The row's stable id. Passed to the renderer as a prop. */
  id: string;
}

export interface ChildRowContributor {
  /** Parent row kind (e.g. "project", "dashboard"). */
  parentType: string;
  /** Source of the registration (extension id). */
  source: string;
  /** Returns child row descriptors for the given parent id. */
  contribute: (parentId: string) => ContributedChildRow[];
}

const _store = writable<ChildRowContributor[]>([]);

export const childRowContributorStore: Readable<ChildRowContributor[]> = _store;

export function registerChildRowContributor(c: ChildRowContributor): void {
  _store.update((list) => [...list, c]);
}

export function unregisterChildRowContributorsBySource(source: string): void {
  _store.update((list) => list.filter((c) => c.source !== source));
}

/**
 * Enumerate every contributed child row for the given parent. Iterates
 * contributors in registration order; falls back to an empty array
 * when no contributors target this parentType. A misbehaving
 * contributor's throw is caught so it can't poison its peers.
 */
export function getChildRowsFor(
  parentType: string,
  parentId: string,
): ContributedChildRow[] {
  const rows: ContributedChildRow[] = [];
  for (const c of get(_store)) {
    if (c.parentType !== parentType) continue;
    try {
      rows.push(...c.contribute(parentId));
    } catch {
      // Swallow.
    }
  }
  return rows;
}

/** Test-only reset. */
export function resetChildRowContributors(): void {
  _store.set([]);
}
