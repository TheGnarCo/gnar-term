import { writable, get } from "svelte/store";
import { saveState, getState } from "../config";
import type { NestedWorkspaceDef, Workspace } from "../config";

export interface ArchivedRow {
  kind: "workspace" | "workspace-group";
  id: string;
}

export interface ArchivedWorkspaceDef {
  def: NestedWorkspaceDef & { name: string };
}

export interface ArchivedGroupDef {
  group: Workspace;
  workspaceDefs: (NestedWorkspaceDef & { name: string })[];
}

export type ArchivedDefEntry = ArchivedWorkspaceDef | ArchivedGroupDef;

export interface ArchivedDefsMap {
  nestedWorkspaces: Record<string, ArchivedWorkspaceDef>;
  groups: Record<string, ArchivedGroupDef>;
}

const _archivedOrder = writable<ArchivedRow[]>([]);
export const archivedOrder = _archivedOrder;

const _archivedDefs = writable<ArchivedDefsMap>({
  nestedWorkspaces: {},
  groups: {},
});
export const archivedDefs = _archivedDefs;

function isArchivedRow(v: unknown): v is ArchivedRow {
  return (
    typeof v === "object" &&
    v !== null &&
    "kind" in v &&
    "id" in v &&
    typeof (v as ArchivedRow).id === "string" &&
    ((v as ArchivedRow).kind === "workspace" ||
      (v as ArchivedRow).kind === "workspace-group")
  );
}

export function initArchiveFromState(): void {
  const state = getState();
  const order = Array.isArray(state.archivedOrder)
    ? state.archivedOrder.filter(isArchivedRow)
    : [];
  const defs = (state.archivedDefs ?? {
    nestedWorkspaces: {},
    groups: {},
  }) as ArchivedDefsMap;
  _archivedOrder.set(order);
  _archivedDefs.set(defs);
}

export function addToArchive(
  row: { kind: "workspace"; id: string },
  entry: ArchivedWorkspaceDef,
): void;
export function addToArchive(
  row: { kind: "workspace-group"; id: string },
  entry: ArchivedGroupDef,
): void;
export function addToArchive(row: ArchivedRow, entry: ArchivedDefEntry): void {
  _archivedOrder.update((list) => {
    if (list.some((r) => r.kind === row.kind && r.id === row.id)) return list;
    return [...list, row];
  });
  if (row.kind === "workspace") {
    _archivedDefs.update((defs) => ({
      ...defs,
      nestedWorkspaces: {
        ...defs.nestedWorkspaces,
        [row.id]: entry as ArchivedWorkspaceDef,
      },
    }));
  } else {
    _archivedDefs.update((defs) => ({
      ...defs,
      groups: { ...defs.groups, [row.id]: entry as ArchivedGroupDef },
    }));
  }
  persist();
}

export function removeFromArchive(row: ArchivedRow): void {
  _archivedOrder.update((list) =>
    list.filter((r) => !(r.kind === row.kind && r.id === row.id)),
  );
  if (row.kind === "workspace") {
    _archivedDefs.update((defs) => {
      const { [row.id]: _removed, ...rest } = defs.nestedWorkspaces;
      return { ...defs, nestedWorkspaces: rest };
    });
  } else {
    _archivedDefs.update((defs) => {
      const { [row.id]: _removed, ...rest } = defs.groups;
      return { ...defs, groups: rest };
    });
  }
  persist();
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist(): void {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    saveState({
      archivedOrder: get(_archivedOrder),
      archivedDefs: get(_archivedDefs),
    }).catch((err) =>
      console.error("[archive] failed to persist archive state:", err),
    );
  }, 500);
}
