import type { Workspace } from "../types";
import type { RootWorkspace } from "../config";

export interface SwitcherRow {
  ws: Workspace;
  idx: number;
  rootLabel: string;
  kind: "branch" | "root";
  depth: number; // 0 for root headers and standalone branch rows, 1 for branch rows under a root
  wsId?: string; // root Workspace id, only present on header rows
}

/**
 * Filter Branches for the workspace switcher palette.
 *
 * When rootWorkspaces is provided (non-empty), the list is grouped:
 *   - For each Root Workspace: one header row (kind="root", depth=0)
 *     followed by its Branches (kind="branch", depth=1).
 *   - Branches with no rootWorkspaceId (or pointing at an unknown
 *     Root) appear at depth=0 after all groups.
 *
 * When rootWorkspaces is empty (default), the list is flat — all
 * Branches are returned with kind="branch", depth=0, and rootLabel
 * set from rootMap.
 *
 * The idx on branch rows is the flat index into the workspaces array —
 * preserved so switchWorkspace(idx) continues to work unchanged.
 *
 * @param workspaces - flat list from workspaces store
 * @param rootMap - map from rootWorkspaceId → root Workspace
 * @param query - raw user input (empty string = return all)
 * @param rootWorkspaces - ordered list of root Workspaces (enables grouped mode)
 * @returns rows that match the query, preserving original indices
 */
export function filterWorkspaces(
  workspaces: Workspace[],
  rootMap: Map<string, RootWorkspace>,
  query: string,
  rootWorkspaces: RootWorkspace[] = [],
): SwitcherRow[] {
  const q = query.trim().toLowerCase();

  // Flat mode (no root Workspaces): preserve original behavior
  if (rootWorkspaces.length === 0) {
    const rows: SwitcherRow[] = workspaces.map((ws, idx) => {
      const rootId = ws.rootWorkspaceId;
      const root = rootId ? rootMap.get(rootId) : undefined;
      return {
        ws,
        idx,
        rootLabel: root?.name ?? "",
        kind: "branch",
        depth: 0,
      };
    });

    if (!q) return rows;

    return rows.filter(({ ws, rootLabel }) => {
      const haystack = `${rootLabel} ${ws.name}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  // Grouped mode: root Workspaces provided
  const rootIds = new Set(rootWorkspaces.map((w) => w.id));

  // Partition branches into root-children and standalone
  const byRoot = new Map<string, SwitcherRow[]>();
  const standaloneRows: SwitcherRow[] = [];

  for (let idx = 0; idx < workspaces.length; idx++) {
    const ws = workspaces[idx]!;
    // A workspace nests under a Root if it points at one (branches +
    // dashboards) or if it IS the Root itself (the runtime entry shares
    // its id with the RootWorkspace per ADR-004).
    const rootRef = ws.rootWorkspaceId;
    const isOwnRoot = rootIds.has(ws.id);
    const bucketRootId = isOwnRoot
      ? ws.id
      : rootRef && rootIds.has(rootRef)
        ? rootRef
        : undefined;
    const root = bucketRootId ? rootMap.get(bucketRootId) : undefined;

    const row: SwitcherRow = {
      ws,
      idx,
      rootLabel: root?.name ?? "",
      kind: "branch",
      depth: bucketRootId ? 1 : 0,
    };

    if (bucketRootId) {
      const bucket = byRoot.get(bucketRootId) ?? [];
      bucket.push(row);
      byRoot.set(bucketRootId, bucket);
    } else {
      standaloneRows.push(row);
    }
  }

  // Build the ordered output
  const result: SwitcherRow[] = [];

  for (const root of rootWorkspaces) {
    // Sort branches: main workspace first, then worktree branches, then dashboards
    const branches = (byRoot.get(root.id) ?? []).sort(
      (a, b) => wsTypeOrder(a.ws) - wsTypeOrder(b.ws),
    );

    if (!q) {
      // No filter: emit root header then all its branches
      result.push(makeRootRow(root));
      result.push(...branches);
    } else {
      const rootNameMatches = root.name.toLowerCase().includes(q);
      const matchingBranches = branches.filter((row) =>
        row.ws.name.toLowerCase().includes(q),
      );

      if (rootNameMatches || matchingBranches.length > 0) {
        result.push(makeRootRow(root));
        // When root name matches, show all branches; otherwise only matching ones
        result.push(...(rootNameMatches ? branches : matchingBranches));
      }
    }
  }

  // Append standalone branch rows
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

function makeRootRow(root: RootWorkspace): SwitcherRow {
  // The ws field on root rows holds a minimal Workspace-shaped object.
  // Consumers must check kind === "root" before treating it as a real branch workspace.
  return {
    ws: {
      id: root.id,
      name: root.name,
      paneLayout: {
        type: "pane",
        pane: { id: "", surfaces: [], activeSurfaceId: null },
      },
      activePaneId: null,
    },
    idx: -1,
    rootLabel: "",
    kind: "root",
    depth: 0,
    wsId: root.id,
  };
}
