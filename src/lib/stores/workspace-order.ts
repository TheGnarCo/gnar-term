/**
 * Workspace-row ordering for the Workspaces section.
 *
 * The Workspaces section renders a single interleaved list of rows: one row
 * per anchor workspace (and any pinned extension rows). Each row is identified
 * by `{kind, id}`. Members (workspaces with `anchorWorkspaceId` set) never
 * appear here — they live nested inside their anchor's group.
 *
 * This module owns:
 *   - the ordered list
 *   - mutation helpers for append / prepend / insert / remove / move
 *
 * No persistence wiring lives here yet — Stage 2 adds the debounced persist.
 */
import { writable, get } from "svelte/store";

export interface WorkspaceRow {
  kind: "workspace" | string;
  id: string;
}

const _workspaceOrder = writable<WorkspaceRow[]>([]);
export const workspaceOrder = _workspaceOrder;

const rowKey = (r: WorkspaceRow): string => `${r.kind}:${r.id}`;

// Tracks the current row keys for O(1) dedup. Stays in sync with
// _workspaceOrder via every mutation helper below; rebuilt from scratch in
// setWorkspaceOrder. Bootstrap is O(N) instead of O(N²) when the same helper
// is called once per workspace during session restore.
let _rowKeys = new Set<string>();

/** Replace the full order. Used during bootstrap and drag-drop reorder. */
export function setWorkspaceOrder(next: WorkspaceRow[]): void {
  _workspaceOrder.set(next);
  _rowKeys = new Set(next.map(rowKey));
}

/** Insert a row at position 0 if not already present. */
export function prependWorkspaceRow(row: WorkspaceRow): void {
  const k = rowKey(row);
  if (_rowKeys.has(k)) return;
  _workspaceOrder.update((current) => [row, ...current]);
  _rowKeys.add(k);
}

/** Append a row to the end if not already present. */
export function appendWorkspaceRow(row: WorkspaceRow): void {
  const k = rowKey(row);
  if (_rowKeys.has(k)) return;
  _workspaceOrder.update((current) => [...current, row]);
  _rowKeys.add(k);
}

/** Remove a row by kind + id. No-op if missing. */
export function removeWorkspaceRow(row: WorkspaceRow): void {
  const k = rowKey(row);
  if (!_rowKeys.has(k)) return;
  _workspaceOrder.update((current) =>
    current.filter((r) => !(r.kind === row.kind && r.id === row.id)),
  );
  _rowKeys.delete(k);
}

/** Insert a row at the given index. No-op if the row is already present. */
export function insertWorkspaceRow(at: number, row: WorkspaceRow): void {
  const k = rowKey(row);
  if (_rowKeys.has(k)) return;
  _workspaceOrder.update((current) => {
    const next = [...current];
    next.splice(Math.max(0, Math.min(next.length, at)), 0, row);
    return next;
  });
  _rowKeys.add(k);
}

/** Move the row at `from` to position `to`. Indices are into the full list. */
export function moveWorkspaceRow(from: number, to: number): void {
  const current = get(_workspaceOrder);
  if (from < 0 || from >= current.length) return;
  const next = [...current];
  const [item] = next.splice(from, 1);
  if (!item) return;
  const insertAt = to > from ? to - 1 : to;
  next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, item);
  _workspaceOrder.set(next);
  _rowKeys = new Set(next.map(rowKey));
}

/**
 * Bootstrap the order from a persisted list, filling in any rows whose
 * referent is known but missing from the persisted list (appended to the end)
 * and dropping any entries whose referent is unknown.
 *
 * `currentRows` enumerates every row that should currently exist: one
 * `{kind: "workspace", id}` per anchor workspace, plus any pinned extension
 * rows. The persisted order is preserved where the row still has a referent;
 * entries whose referent is unknown are dropped because they don't appear in
 * `currentRows`.
 *
 * `persisted` defaults to empty — Stage 2 supplies the persisted order from
 * disk; with no persistence the result is simply `currentRows` in order.
 */
export function bootstrapWorkspaceOrder(
  currentRows: WorkspaceRow[],
  persisted: WorkspaceRow[] = [],
): void {
  const known = new Set<string>();
  for (const r of currentRows) known.add(rowKey(r));

  const next: WorkspaceRow[] = [];
  const seen = new Set<string>();
  for (const r of persisted) {
    const k = rowKey(r);
    if (known.has(k) && !seen.has(k)) {
      next.push(r);
      seen.add(k);
    }
  }
  for (const r of currentRows) {
    const k = rowKey(r);
    if (!seen.has(k)) {
      next.push(r);
      seen.add(k);
    }
  }

  _workspaceOrder.set(next);
  _rowKeys = new Set(next.map(rowKey));
}
