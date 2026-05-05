import type { Workspace } from "../types";
import type { WorkspaceRecord } from "../config";

export interface SwitcherRow {
  ws: Workspace;
  idx: number;
  parentLabel: string;
  kind: "child" | "parent";
  depth: number; // 0 for parent headers and standalone child rows, 1 for child rows under a parent
  wsId?: string; // parent workspace id, only present on parent rows
}

/**
 * Filter child workspaces for the workspace switcher palette.
 *
 * When parentWorkspaces is provided (non-empty), the list is grouped:
 *   - For each parent workspace: one header row (kind="parent", depth=0)
 *     followed by its child workspaces (kind="child", depth=1).
 *   - Standalone child workspaces (no parentWorkspaceId or unknown parent)
 *     appear at depth=0 after all parent groups.
 *
 * When parentWorkspaces is empty (default), the list is flat — all child
 * workspaces are returned with kind="child", depth=0, and parentLabel set
 * from parentMap. This preserves the original behavior.
 *
 * The idx on child rows is the flat index into the workspaces array —
 * preserved so switchWorkspace(idx) continues to work unchanged.
 *
 * @param workspaces - flat list from workspaces store
 * @param parentMap - map from parentWorkspaceId → parent workspace
 * @param query - raw user input (empty string = return all)
 * @param parentWorkspaces - ordered list of parent workspaces (enables grouped mode)
 * @returns rows that match the query, preserving original indices
 */
export function filterWorkspaces(
  workspaces: Workspace[],
  parentMap: Map<string, WorkspaceRecord>,
  query: string,
  parentWorkspaces: WorkspaceRecord[] = [],
): SwitcherRow[] {
  const q = query.trim().toLowerCase();

  // Flat mode (no parent workspaces): preserve original behavior
  if (parentWorkspaces.length === 0) {
    const rows: SwitcherRow[] = workspaces.map((ws, idx) => {
      const parentId = ws.parentWorkspaceId;
      const parent = parentId ? parentMap.get(parentId) : undefined;
      return {
        ws,
        idx,
        parentLabel: parent?.name ?? "",
        kind: "child",
        depth: 0,
      };
    });

    if (!q) return rows;

    return rows.filter(({ ws, parentLabel }) => {
      const haystack = `${parentLabel} ${ws.name}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  // Grouped mode: parent workspaces provided
  const parentIds = new Set(parentWorkspaces.map((w) => w.id));

  // Partition child workspaces into parent-children and standalone
  const byParent = new Map<string, SwitcherRow[]>();
  const standaloneRows: SwitcherRow[] = [];

  for (let idx = 0; idx < workspaces.length; idx++) {
    const ws = workspaces[idx]!;
    const parentId = ws.parentWorkspaceId;
    const isUnderParent = !!(parentId && parentIds.has(parentId));
    const parent = isUnderParent ? parentMap.get(parentId!) : undefined;

    const row: SwitcherRow = {
      ws,
      idx,
      parentLabel: parent?.name ?? "",
      kind: "child",
      depth: isUnderParent ? 1 : 0,
    };

    if (isUnderParent && parentId) {
      const bucket = byParent.get(parentId) ?? [];
      bucket.push(row);
      byParent.set(parentId, bucket);
    } else {
      standaloneRows.push(row);
    }
  }

  // Build the ordered output
  const result: SwitcherRow[] = [];

  for (const parent of parentWorkspaces) {
    // Sort children: main workspace first, then branches, then dashboards
    const children = (byParent.get(parent.id) ?? []).sort(
      (a, b) => wsTypeOrder(a.ws) - wsTypeOrder(b.ws),
    );

    if (!q) {
      // No filter: emit parent header then all its children
      result.push(makeParentRow(parent));
      result.push(...children);
    } else {
      const parentNameMatches = parent.name.toLowerCase().includes(q);
      const matchingChildren = children.filter((row) =>
        row.ws.name.toLowerCase().includes(q),
      );

      if (parentNameMatches || matchingChildren.length > 0) {
        result.push(makeParentRow(parent));
        // When parent name matches, show all children; otherwise only matching ones
        result.push(...(parentNameMatches ? children : matchingChildren));
      }
    }
  }

  // Append standalone child rows
  if (!q) {
    result.push(...standaloneRows);
  } else {
    result.push(
      ...standaloneRows.filter((row) => row.ws.name.toLowerCase().includes(q)),
    );
  }

  return result;
}

function wsTypeOrder(ws: Workspace): number {
  const worktreePath = (ws as { worktreePath?: string }).worktreePath;
  if (!ws.isDashboard && !worktreePath) return 0; // main workspace first
  if (worktreePath) return 1; // branch workspaces second
  return 2; // dashboards last
}

function makeParentRow(parent: WorkspaceRecord): SwitcherRow {
  // The ws field on parent rows holds a minimal Workspace-shaped object.
  // Consumers must check kind === "parent" before treating it as a real child workspace.
  return {
    ws: {
      id: parent.id,
      name: parent.name,
      splitRoot: {
        type: "pane",
        pane: { id: "", surfaces: [], activeSurfaceId: null },
      },
      activePaneId: null,
    },
    idx: -1,
    parentLabel: "",
    kind: "parent",
    depth: 0,
    wsId: parent.id,
  };
}
