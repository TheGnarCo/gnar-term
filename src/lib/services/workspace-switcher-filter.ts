import type { NestedWorkspace } from "../types";
import type { Workspace } from "../config";

export interface SwitcherRow {
  ws: NestedWorkspace;
  idx: number;
  parentLabel: string;
  kind: "nested" | "umbrella";
  depth: number; // 0 for umbrella headers and standalone nested rows, 1 for nested rows under an umbrella
  wsId?: string; // umbrella workspace id, only present on umbrella rows
}

/**
 * Filter nested workspaces for the workspace switcher palette.
 *
 * When umbrellaWorkspaces is provided (non-empty), the list is grouped:
 *   - For each umbrella workspace: one header row (kind="umbrella", depth=0)
 *     followed by its nested workspaces (kind="nested", depth=1).
 *   - Standalone nested workspaces (no parentWorkspaceId or unknown parent)
 *     appear at depth=0 after all umbrella groups.
 *
 * When umbrellaWorkspaces is empty (default), the list is flat — all nested
 * workspaces are returned with kind="nested", depth=0, and parentLabel set
 * from parentMap. This preserves the original behavior.
 *
 * The idx on nested rows is the flat index into the workspaces array —
 * preserved so switchNestedWorkspace(idx) continues to work unchanged.
 *
 * @param workspaces - flat list from nestedWorkspaces store
 * @param parentMap - map from parentWorkspaceId → Workspace (from workspacesStore)
 * @param query - raw user input (empty string = return all)
 * @param umbrellaWorkspaces - ordered list of umbrella Workspace objects (enables grouped mode)
 * @returns rows that match the query, preserving original indices
 */
export function filterWorkspaces(
  workspaces: NestedWorkspace[],
  parentMap: Map<string, Workspace>,
  query: string,
  umbrellaWorkspaces: Workspace[] = [],
): SwitcherRow[] {
  const q = query.trim().toLowerCase();

  // Flat mode (no umbrella workspaces): preserve original behavior
  if (umbrellaWorkspaces.length === 0) {
    const rows: SwitcherRow[] = workspaces.map((ws, idx) => {
      const parentId = ws.metadata?.parentWorkspaceId;
      const parent = parentId ? parentMap.get(parentId) : undefined;
      return {
        ws,
        idx,
        parentLabel: parent?.name ?? "",
        kind: "nested",
        depth: 0,
      };
    });

    if (!q) return rows;

    return rows.filter(({ ws, parentLabel }) => {
      const haystack = `${parentLabel} ${ws.name}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  // Grouped mode: umbrella workspaces provided
  const umbrellaIds = new Set(umbrellaWorkspaces.map((w) => w.id));

  // Partition nested workspaces into umbrella-children and standalone
  const byUmbrella = new Map<string, SwitcherRow[]>();
  const standaloneRows: SwitcherRow[] = [];

  for (let idx = 0; idx < workspaces.length; idx++) {
    const ws = workspaces[idx]!;
    const parentId = ws.metadata?.parentWorkspaceId;
    const isUnderUmbrella = !!(parentId && umbrellaIds.has(parentId));
    const parent = isUnderUmbrella ? parentMap.get(parentId!) : undefined;

    const row: SwitcherRow = {
      ws,
      idx,
      parentLabel: parent?.name ?? "",
      kind: "nested",
      depth: isUnderUmbrella ? 1 : 0,
    };

    if (isUnderUmbrella && parentId) {
      const bucket = byUmbrella.get(parentId) ?? [];
      bucket.push(row);
      byUmbrella.set(parentId, bucket);
    } else {
      standaloneRows.push(row);
    }
  }

  // Build the ordered output
  const result: SwitcherRow[] = [];

  for (const umbrella of umbrellaWorkspaces) {
    const children = byUmbrella.get(umbrella.id) ?? [];

    if (!q) {
      // No filter: emit umbrella header then all its children
      result.push(makeUmbrellaRow(umbrella));
      result.push(...children);
    } else {
      const umbrellaNameMatches = umbrella.name.toLowerCase().includes(q);
      const matchingChildren = children.filter((row) =>
        row.ws.name.toLowerCase().includes(q),
      );

      if (umbrellaNameMatches || matchingChildren.length > 0) {
        result.push(makeUmbrellaRow(umbrella));
        // When umbrella name matches, show all children; otherwise only matching ones
        result.push(...(umbrellaNameMatches ? children : matchingChildren));
      }
    }
  }

  // Append standalone nested rows
  if (!q) {
    result.push(...standaloneRows);
  } else {
    result.push(
      ...standaloneRows.filter((row) => row.ws.name.toLowerCase().includes(q)),
    );
  }

  return result;
}

function makeUmbrellaRow(umbrella: Workspace): SwitcherRow {
  // The ws field on umbrella rows holds a minimal NestedWorkspace-shaped object.
  // Consumers must check kind === "umbrella" before treating it as a real nested workspace.
  return {
    ws: {
      id: umbrella.id,
      name: umbrella.name,
      splitRoot: {
        type: "pane",
        pane: { id: "", surfaces: [], activeSurfaceId: null },
      },
      activePaneId: null,
    },
    idx: -1,
    parentLabel: "",
    kind: "umbrella",
    depth: 0,
    wsId: umbrella.id,
  };
}
