/**
 * Root-row ordering for the Workspaces section.
 *
 * The Workspaces section renders a single interleaved list of root
 * rows: Workspace blocks (kind: "workspace") and pinned extension rows.
 * Each row is identified by {kind, id}. Branches (workspaces with
 * `rootWorkspaceId` set) never appear here — they live nested inside
 * their root's branch list.
 *
 * This module owns:
 *   - the ordered list (persisted across restarts)
 *   - mutation helpers for append / remove / move
 *
 * Renderers for each kind ("workspace", "pseudo-workspace", and any
 * extension-registered kind) are contributed through
 * `registerRootRowRenderer` on the extension API — WorkspaceListBlock
 * looks them up by kind.
 */
import { writable, get } from "svelte/store";
import { saveState, getState } from "../config";

export interface RootRow {
  kind: "workspace" | "pseudo-workspace" | string;
  id: string;
}

const _rootRowOrder = writable<RootRow[]>([]);
export const rootRowOrder = _rootRowOrder;

const rowKey = (r: RootRow): string => `${r.kind}:${r.id}`;

// Tracks the current row keys for O(1) dedup. Stays in sync with
// _rootRowOrder via every mutation helper below; rebuilt from scratch
// in setRootRowOrder. Bootstrap is O(N) instead of O(N²) when the same
// helper is called once per workspace during session restore.
let _rowKeys = new Set<string>();

/** Replace the full order. Used during bootstrap and drag-drop reorder. */
export function setRootRowOrder(next: RootRow[]): void {
  _rootRowOrder.set(next);
  _rowKeys = new Set(next.map(rowKey));
  persist();
}

/** Insert a row at position 0 if not already present. */
export function prependRootRow(row: RootRow): void {
  const k = rowKey(row);
  if (_rowKeys.has(k)) return;
  _rootRowOrder.update((current) => [row, ...current]);
  _rowKeys.add(k);
  persist();
}

/** Append a row to the end if not already present. */
export function appendRootRow(row: RootRow): void {
  const k = rowKey(row);
  if (_rowKeys.has(k)) return;
  _rootRowOrder.update((current) => [...current, row]);
  _rowKeys.add(k);
  persist();
}

/** Remove a row by kind + id. No-op if missing. */
export function removeRootRow(row: RootRow): void {
  const k = rowKey(row);
  if (!_rowKeys.has(k)) return;
  _rootRowOrder.update((current) =>
    current.filter((r) => !(r.kind === row.kind && r.id === row.id)),
  );
  _rowKeys.delete(k);
  persist();
}

/** Insert a row at the given index. No-op if the row is already present. */
export function insertRootRow(at: number, row: RootRow): void {
  const k = rowKey(row);
  if (_rowKeys.has(k)) return;
  _rootRowOrder.update((current) => {
    const next = [...current];
    next.splice(Math.max(0, Math.min(next.length, at)), 0, row);
    return next;
  });
  _rowKeys.add(k);
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
 * Bootstrap the order from persisted state, filling in any rows whose
 * referent is known but missing from the persisted list (appended to
 * the end) and dropping any entries whose referent is unknown.
 *
 * `extensionRows` enumerates every row that should currently exist:
 * one `{kind: "workspace", id}` per Root workspace, plus any pinned
 * extension rows. The persisted order is preserved where the row still
 * has a referent; legacy persisted shapes (e.g. `kind:"child-workspace"`
 * from pre-Stage-10 sessions) are dropped because they don't appear in
 * `extensionRows`.
 */
export function bootstrapRootRowOrder(extensionRows: RootRow[]): void {
  const persisted = getState().rootRowOrder ?? [];
  const key = (r: RootRow) => `${r.kind}:${r.id}`;

  const known = new Set<string>();
  for (const r of extensionRows) known.add(key(r));

  const next: RootRow[] = [];
  const seen = new Set<string>();
  for (const r of persisted) {
    const k = key(r);
    if (known.has(k) && !seen.has(k)) {
      next.push(r);
      seen.add(k);
    }
  }
  for (const r of extensionRows) {
    const k = key(r);
    if (!seen.has(k)) {
      next.push(r);
      seen.add(k);
    }
  }

  _rootRowOrder.set(next);
  _rowKeys = new Set(next.map(rowKey));
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
