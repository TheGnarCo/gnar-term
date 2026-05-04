import { writable, get } from "svelte/store";
import { saveState, getState } from "../config";
import type { NestedWorkspaceDef, Workspace } from "../config";

export interface ArchivedWorkspaceDef {
  workspace: Workspace;
  nestedWorkspaceDefs: (NestedWorkspaceDef & { name: string })[];
}

export interface ArchivedDefsMap {
  workspaces: Record<string, ArchivedWorkspaceDef>;
}

const _archivedOrder = writable<string[]>([]);
export const archivedOrder = _archivedOrder;

const _archivedDefs = writable<ArchivedDefsMap>({ workspaces: {} });
export const archivedDefs = _archivedDefs;

export function initArchiveFromState(): void {
  const state = getState();
  const order = Array.isArray(state.archivedOrder)
    ? state.archivedOrder.filter((v): v is string => typeof v === "string")
    : [];
  const defs = (state.archivedDefs ?? { workspaces: {} }) as ArchivedDefsMap;
  _archivedOrder.set(order);
  _archivedDefs.set(defs);
}

export function addToArchive(id: string, entry: ArchivedWorkspaceDef): void {
  _archivedOrder.update((list) => (list.includes(id) ? list : [...list, id]));
  _archivedDefs.update((defs) => ({
    ...defs,
    workspaces: { ...defs.workspaces, [id]: entry },
  }));
  persist();
}

export function removeFromArchive(id: string): void {
  _archivedOrder.update((list) => list.filter((x) => x !== id));
  _archivedDefs.update((defs) => {
    const { [id]: _removed, ...rest } = defs.workspaces;
    return { ...defs, workspaces: rest };
  });
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
