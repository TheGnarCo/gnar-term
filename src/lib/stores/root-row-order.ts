/**
 * Root-row ordering for the Workspaces section.
 *
 * The Workspaces section renders a single interleaved list of root
 * rows: unclaimed nestedWorkspaces (kind: "nested-workspace") and workspace
 * blocks (kind: "workspace"). Each row is identified by {kind, id}.
 * Users can drag freely across this list — a nested workspace can sit
 * between two workspaces, a workspace between two nested workspaces.
 *
 * This module owns:
 *   - the ordered list (persisted across restarts)
 *   - a derived view that filters out rows whose referent no longer
 *     exists (deleted workspace, nested workspace that got claimed by a
 *     workspace, etc.) and appends newly-created entities in insertion
 *     order
 *   - mutation helpers for append / remove / move
 *
 * Renderers for non-nested-workspace kinds (workspaces, future extension
 * kinds) are contributed through `registerRootRowRenderer` on the
 * extension API — WorkspaceListBlock looks them up by kind.
 */
import { writable, derived, get } from "svelte/store";
import { saveState, getState } from "../config";

export interface RootRow {
  kind: "nested-workspace" | "workspace" | string;
  id: string;
}

const _rootRowOrder = writable<RootRow[]>([]);
export const rootRowOrder = _rootRowOrder;

/** Replace the full order. Used during bootstrap and drag-drop reorder. */
export function setRootRowOrder(next: RootRow[]): void {
  _rootRowOrder.set(next);
  persist();
}

/** Insert a row at position 0 if not already present. */
export function prependRootRow(row: RootRow): void {
  const current = get(_rootRowOrder);
  if (current.some((r) => r.kind === row.kind && r.id === row.id)) return;
  _rootRowOrder.set([row, ...current]);
  persist();
}

/** Append a row to the end if not already present. */
export function appendRootRow(row: RootRow): void {
  const current = get(_rootRowOrder);
  if (current.some((r) => r.kind === row.kind && r.id === row.id)) return;
  _rootRowOrder.set([...current, row]);
  persist();
}

/** Remove a row by kind + id. No-op if missing. */
export function removeRootRow(row: RootRow): void {
  const current = get(_rootRowOrder);
  const next = current.filter((r) => !(r.kind === row.kind && r.id === row.id));
  if (next.length === current.length) return;
  _rootRowOrder.set(next);
  persist();
}

/** Insert a row at the given index. No-op if the row is already present. */
export function insertRootRow(at: number, row: RootRow): void {
  const current = get(_rootRowOrder);
  if (current.some((r) => r.kind === row.kind && r.id === row.id)) return;
  const next = [...current];
  next.splice(Math.max(0, Math.min(next.length, at)), 0, row);
  _rootRowOrder.set(next);
  persist();
}

/** Move the row at `from` to position `to`. Indices are into the full list. */
export function moveRootRow(from: number, to: number): void {
  const current = get(_rootRowOrder);
  if (from < 0 || from >= current.length) return;
  const next = [...current];
  const [item] = next.splice(from, 1);
  if (!item) return;
  const insertAt = to > from ? to - 1 : to;
  next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, item);
  _rootRowOrder.set(next);
  persist();
}

/**
 * Bootstrap the order from persisted state, filling in any known entities
 * that aren't yet listed (appended to the end) and dropping any entries
 * whose referent is unknown.
 *
 * `knownWorkspaceIds` comes from the nestedWorkspaces store; `extensionRows`
 * from registered extensions (via registerRootRowBootstrapContributor).
 */
export function bootstrapRootRowOrder(
  knownWorkspaceIds: string[],
  extensionRows: RootRow[],
): void {
  const persisted = getState().rootRowOrder ?? [];
  const key = (r: RootRow) => `${r.kind}:${r.id}`;

  // Build the full known set — anything persisted that isn't in it is
  // stale (nested workspace deleted, workspace removed) and gets dropped.
  const known = new Set<string>();
  for (const id of knownWorkspaceIds)
    known.add(key({ kind: "nested-workspace", id }));
  for (const r of extensionRows) known.add(key(r));

  // Keep persisted order where referents still exist.
  const next: RootRow[] = [];
  const seen = new Set<string>();
  for (const r of persisted) {
    const k = key(r);
    if (known.has(k) && !seen.has(k)) {
      next.push(r);
      seen.add(k);
    }
  }

  // Append entities that weren't in the persisted order —
  // extension-contributed rows first (workspaces), then unclaimed
  // nestedWorkspaces. Matches the legacy "workspaces above nested
  // workspaces" default on first-run installs.
  for (const r of extensionRows) {
    const k = key(r);
    if (!seen.has(k)) {
      next.push(r);
      seen.add(k);
    }
  }
  for (const id of knownWorkspaceIds) {
    const k = key({ kind: "nested-workspace", id });
    if (!seen.has(k)) {
      next.push({ kind: "nested-workspace", id });
      seen.add(k);
    }
  }

  _rootRowOrder.set(next);
  persist();
}

// Debounced persistence so rapid mutations (create/claim/unclaim storms)
// don't blow up the state file.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void saveState({ rootRowOrder: get(_rootRowOrder) });
  }, 500);
}

/**
 * Derived store returning the current order as-is. Future-proofed as a
 * derived so the filtering logic can tighten without churning callers.
 */
export const rootRows = derived(rootRowOrder, ($order) => $order);
