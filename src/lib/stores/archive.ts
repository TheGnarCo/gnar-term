import { writable, get } from "svelte/store";
import { saveState, getState } from "../config";
import type { WorkspaceDef, WorkspaceGroupEntry } from "../config";

export interface ArchivedRow {
  kind: "workspace" | "workspace-group";
  id: string;
}

export interface ArchivedWorkspaceDef {
  def: WorkspaceDef & { name: string };
}

export interface ArchivedGroupDef {
  group: WorkspaceGroupEntry;
  workspaceDefs: (WorkspaceDef & { name: string })[];
}

export type ArchivedDefEntry = ArchivedWorkspaceDef | ArchivedGroupDef;

export interface ArchivedDefsMap {
  workspaces: Record<string, ArchivedWorkspaceDef>;
  groups: Record<string, ArchivedGroupDef>;
}

const _archivedOrder = writable<ArchivedRow[]>([]);
export const archivedOrder = _archivedOrder;

const _archivedDefs = writable<ArchivedDefsMap>({ workspaces: {}, groups: {} });
export const archivedDefs = _archivedDefs;

export function initArchiveFromState(): void {
  const state = getState();
  const order = Array.isArray(state.archivedOrder)
    ? (state.archivedOrder as ArchivedRow[])
    : [];
  const defs = (state.archivedDefs ?? {
    workspaces: {},
    groups: {},
  }) as ArchivedDefsMap;
  _archivedOrder.set(order);
  _archivedDefs.set(defs);
}

export function addToArchive(row: ArchivedRow, entry: ArchivedDefEntry): void {
  _archivedOrder.update((list) => {
    if (list.some((r) => r.kind === row.kind && r.id === row.id)) return list;
    return [...list, row];
  });
  if (row.kind === "workspace") {
    _archivedDefs.update((defs) => ({
      ...defs,
      workspaces: {
        ...defs.workspaces,
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
      const { [row.id]: _removed, ...rest } = defs.workspaces;
      return { ...defs, workspaces: rest };
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
    void saveState({
      archivedOrder: get(_archivedOrder),
      archivedDefs: get(_archivedDefs),
    });
  }, 500);
}
