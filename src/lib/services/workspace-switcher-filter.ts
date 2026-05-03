import type { NestedWorkspace } from "../types";
import type { Workspace } from "../config";

export interface SwitcherRow {
  ws: NestedWorkspace;
  idx: number;
  parentLabel: string;
}

/**
 * Filter nested workspaces for the workspace switcher palette.
 *
 * @param workspaces - flat list from nestedWorkspaces store
 * @param parentMap - map from parentWorkspaceId → Workspace (from workspacesStore)
 * @param query - raw user input (empty string = return all)
 * @returns rows that match the query, preserving original indices
 */
export function filterWorkspaces(
  workspaces: NestedWorkspace[],
  parentMap: Map<string, Workspace>,
  query: string,
): SwitcherRow[] {
  const rows: SwitcherRow[] = workspaces.map((ws, idx) => {
    const parentId = ws.metadata?.parentWorkspaceId;
    const parent = parentId ? parentMap.get(parentId) : undefined;
    return { ws, idx, parentLabel: parent?.name ?? "" };
  });

  const q = query.trim().toLowerCase();
  if (!q) return rows;

  return rows.filter(({ ws, parentLabel }) => {
    const haystack = `${parentLabel} ${ws.name}`.toLowerCase();
    return haystack.includes(q);
  });
}
