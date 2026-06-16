/**
 * Command-palette + keyboard entry points for workspace grouping.
 *
 * These wrap the lower-level grouping operations in `workspace-service` with
 * the selection/ordering glue the palette and ⌘1-9 shortcuts need:
 *
 *   - `Switch to:` / ⌘1-9 resolve against the sidebar's `workspaceOrder`
 *     (anchor rows in display order) rather than the raw `$workspaces` array
 *     index, so a grouped sidebar maps the Nth visible row to the right
 *     workspace (RISK 1).
 *   - Group / Add-to-Group / Ungroup operate on the active workspace and the
 *     anchor it currently relates to.
 *   - Collapse/Expand toggles the active workspace's group via
 *     `groupCollapsedState`.
 *
 * Kept as a thin, testable service module so App.svelte stays a wiring shell.
 */
import { get } from "svelte/store";
import { workspaces, activeWorkspace } from "../stores/workspace";
import { workspaceOrder, insertWorkspaceRow } from "../stores/workspace-order";
import { groupCollapsedState, setGroupCollapsed } from "../stores/ui";
import { isAnchorWorkspace, isWorkspaceMember, type Workspace } from "../types";
import { switchWorkspace } from "./workspace-service";
import {
  addMemberToGroup,
  createGroupWithAnchor,
  getMembersOfGroup,
  promoteMemberToAnchor,
  removeMemberFromAllGroups,
} from "./workspace-service";

/**
 * The workspace ids that own a top-level sidebar row, in display order.
 * Derived from `workspaceOrder` (anchor rows only — members nest inside their
 * anchor's group and never own a row). Falls back to the raw `$workspaces`
 * anchor list when the order is empty (e.g. before bootstrap).
 */
export function orderedAnchorIds(): string[] {
  const order = get(workspaceOrder);
  const rowIds = order
    .filter((r) => r.kind === "workspace")
    .map((r) => r.id);
  if (rowIds.length > 0) return rowIds;
  return get(workspaces).filter(isAnchorWorkspace).map((w) => w.id);
}

/**
 * The display-ordered list of anchor workspaces — the rows the user sees,
 * resolved from `workspaceOrder` back to live `Workspace` records. Rows whose
 * referent is missing from the store are dropped.
 */
export function orderedAnchorWorkspaces(): Workspace[] {
  const byId = new Map(get(workspaces).map((w) => [w.id, w]));
  const out: Workspace[] = [];
  for (const id of orderedAnchorIds()) {
    const w = byId.get(id);
    if (w) out.push(w);
  }
  return out;
}

/**
 * Switch to the Nth workspace row in *display* order (0-based). Resolves the
 * order position to the workspace's index in the `$workspaces` array and
 * delegates to `switchWorkspace`. No-op when `orderIdx` is out of range.
 */
export function switchToOrderedWorkspace(orderIdx: number): void {
  const ordered = orderedAnchorIds();
  if (orderIdx < 0 || orderIdx >= ordered.length) return;
  const targetId = ordered[orderIdx];
  const arrayIdx = get(workspaces).findIndex((w) => w.id === targetId);
  if (arrayIdx < 0) return;
  switchWorkspace(arrayIdx);
}

/** Switch to the LAST workspace row in display order (⌘9 semantics). */
export function switchToLastOrderedWorkspace(): void {
  const ordered = orderedAnchorIds();
  if (ordered.length === 0) return;
  switchToOrderedWorkspace(ordered.length - 1);
}

/**
 * The group id (anchor workspace id) the given workspace currently belongs to,
 * or null when it is neither an anchor with members nor a member.
 *
 * - A member resolves to its `anchorWorkspaceId`.
 * - An anchor that owns members resolves to itself.
 * - A standalone (degenerate-anchor) workspace resolves to null — it has no
 *   group to collapse.
 */
export function groupIdOf(ws: Workspace): string | null {
  if (isWorkspaceMember(ws)) return ws.anchorWorkspaceId ?? null;
  if ((ws.memberWorkspaceIds?.length ?? 0) > 0) return ws.id;
  return null;
}

/**
 * "Group Workspaces" — make the active workspace the anchor of a new group by
 * absorbing the next sibling anchor as its first member. Operates on the
 * display order so "next" is the visually adjacent row. No-op when the active
 * workspace is already a member, or has no following sibling.
 *
 * Returns the absorbed member's id, or null when nothing was grouped.
 */
export function groupActiveWorkspace(): string | null {
  const active = get(activeWorkspace);
  if (!active || isWorkspaceMember(active)) return null;
  const ordered = orderedAnchorIds();
  const idx = ordered.indexOf(active.id);
  if (idx < 0) return null;
  // Pick the next standalone anchor as the first member.
  const list = get(workspaces);
  for (let i = idx + 1; i < ordered.length; i++) {
    const candidate = list.find((w) => w.id === ordered[i]);
    if (!candidate) continue;
    // Only absorb a standalone anchor (one with no members of its own).
    if ((candidate.memberWorkspaceIds?.length ?? 0) > 0) continue;
    if (createGroupWithAnchor(active.id, candidate.id)) return candidate.id;
  }
  return null;
}

/**
 * "Add to Group" — add the active workspace as a member of `anchorId`'s group.
 * Returns false when the active workspace is missing, is the anchor itself, or
 * is already grouped.
 */
export function addActiveToGroup(anchorId: string): boolean {
  const active = get(activeWorkspace);
  if (!active || active.id === anchorId) return false;
  if (isWorkspaceMember(active)) return false;
  return addMemberToGroup(anchorId, active.id);
}

/**
 * "Ungroup" — dissolve the group the active workspace belongs to. If the
 * active workspace is a member, just detach it; if it is the anchor, promote
 * its first member so the remaining members survive, then keep detaching until
 * the group is empty. Returns true when anything was ungrouped.
 */
export function ungroupActiveWorkspace(): boolean {
  const active = get(activeWorkspace);
  if (!active) return false;

  // Active is a member: detach it from its anchor's group.
  if (isWorkspaceMember(active)) {
    detachMember(active);
    return true;
  }

  // Active is an anchor with members: fully dissolve the group by detaching
  // every member. Each member becomes a standalone anchor again.
  const members = getMembersOfGroup(active.id);
  if (members.length === 0) return false;
  for (const m of members) detachMember(m);
  return true;
}

/**
 * Detach a single member from whatever group it belongs to: clear its anchor
 * tag, strip it from every ordering array, and restore its standalone sidebar
 * row. Routed so both member-ungroup and anchor-dissolve share one path.
 */
function detachMember(member: Workspace): void {
  const anchorId = member.anchorWorkspaceId;
  removeMemberFromAllGroups(member.id);
  // Clear the membership tag so it reads as a standalone anchor again.
  workspaces.update((list) =>
    list.map((w) => {
      if (w.id !== member.id) return w;
      const { anchorWorkspaceId, ...rest } = w;
      void anchorWorkspaceId;
      return rest;
    }),
  );
  // Restore a top-level row positioned right after its former anchor's row.
  const order = get(workspaceOrder);
  const at = anchorId
    ? order.findIndex((r) => r.kind === "workspace" && r.id === anchorId)
    : -1;
  insertWorkspaceRow(at < 0 ? order.length : at + 1, {
    kind: "workspace",
    id: member.id,
  });
}

/**
 * "Collapse/Expand Group" — toggle the collapsed state of the active
 * workspace's group. A missing entry defaults to collapsed, so the first
 * toggle expands. No-op when the active workspace has no group.
 */
export function toggleActiveGroupCollapsed(): void {
  const active = get(activeWorkspace);
  if (!active) return;
  const groupId = groupIdOf(active);
  if (!groupId) return;
  const collapsed = get(groupCollapsedState).get(groupId) ?? true;
  setGroupCollapsed(groupId, !collapsed);
}

/** The anchor workspaces that already own at least one member. */
export function anchorsWithMembers(): Workspace[] {
  return get(workspaces).filter(
    (w) => isAnchorWorkspace(w) && (w.memberWorkspaceIds?.length ?? 0) > 0,
  );
}

// Re-export the back-edge so callers wiring grouping commands can reach it
// from one module without importing workspace-service directly.
export { promoteMemberToAnchor };
