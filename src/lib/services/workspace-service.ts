import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { workspaces, activeWorkspaceIdx, activeWorkspace, activeSurface } from "../stores/workspace";
import { showInputPrompt } from "../stores/ui";
import { createTerminalSurface } from "../terminal-service";
import { openPreview } from "../../preview/index";
import { uid, getAllPanes, getAllSurfaces, isTerminalSurface, isAnchorWorkspace, isWorkspaceMember, findPaneInWorkspace, type Workspace, type Pane, type SplitNode } from "../types";
import { saveConfig, getConfig, type WorkspaceDef, type LayoutNode } from "../config";
import {
  appendWorkspaceRow,
  removeWorkspaceRow,
  insertWorkspaceRow,
  workspaceOrder,
} from "../stores/workspace-order";
import { schedulePersist } from "./workspace-persist";
import { safeFocus } from "./service-helpers";

/** Snapshot of the workspaces store. */
export function getWorkspaces(): Workspace[] {
  return get(workspaces);
}

/**
 * Replace the workspaces store with `next` and schedule a persist. The single
 * choke-point for grouping mutations so every structural change writes through
 * to state.json.
 */
function setWorkspaces(next: Workspace[]): void {
  workspaces.set(next);
  schedulePersist();
}

export async function createWorkspace(name: string) {
  const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const ws: Workspace = {
    id: uid(), name,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };

  const surface = await createTerminalSurface(pane);

  workspaces.update(list => [...list, ws]);
  // Standalone workspaces are anchors — they get a sidebar row. Members
  // (anchorWorkspaceId set) never do.
  appendWorkspaceRow({ kind: "workspace", id: ws.id });
  activeWorkspaceIdx.set(get(workspaces).length - 1);
  schedulePersist();
  safeFocus(surface);
}

export async function createWorkspaceFromDef(
  def: WorkspaceDef,
  opts: { restoring?: boolean } = {},
) {
  const wsName = def.name || `Workspace ${get(workspaces).length + 1}`;
  const rootCwd = def.cwd;

  async function buildTree(nodeDef: LayoutNode, inheritedCwd?: string): Promise<SplitNode> {
    if ("pane" in nodeDef) {
      const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
      for (const sDef of nodeDef.pane.surfaces) {
        const cwd = sDef.cwd || inheritedCwd;
        if (sDef.type === "markdown" && sDef.path) {
          const preview = await openPreview(sDef.path);
          const surface = {
            kind: "preview" as const,
            id: preview.id, filePath: preview.filePath,
            title: sDef.name || preview.title,
            element: preview.element, watchId: preview.watchId,
            hasUnread: false,
          };
          pane.surfaces.push(surface);
          if (!pane.activeSurfaceId || sDef.focus) pane.activeSurfaceId = surface.id;
        } else {
          const surface = await createTerminalSurface(pane, cwd);
          if (sDef.name) surface.title = sDef.name;
          if (sDef.command) surface.startupCommand = sDef.command;
          if (sDef.focus) pane.activeSurfaceId = surface.id;
        }
      }
      if (pane.surfaces.length === 0) {
        await createTerminalSurface(pane, inheritedCwd);
      }
      return { type: "pane", pane };
    } else {
      const left = await buildTree(nodeDef.children[0], inheritedCwd);
      const right = await buildTree(nodeDef.children[1], inheritedCwd);
      return { type: "split", direction: nodeDef.direction, ratio: nodeDef.split || 0.5, children: [left, right] };
    }
  }

  let splitRoot: SplitNode;
  if (def.layout) {
    splitRoot = await buildTree(def.layout, rootCwd);
  } else {
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    await createTerminalSurface(pane, rootCwd);
    splitRoot = { type: "pane", pane };
  }

  const ws: Workspace = {
    // Reuse the persisted id when restoring so its workspace-order row
    // (keyed by id) still resolves and grouping back-refs stay valid.
    id: def.id ?? uid(),
    name: wsName, splitRoot,
    activePaneId: getAllPanes(splitRoot)[0]?.id ?? null,
  };
  // Carry the in-scope grouping fields onto the live workspace.
  if (def.anchorWorkspaceId !== undefined)
    ws.anchorWorkspaceId = def.anchorWorkspaceId;
  if (def.memberWorkspaceIds !== undefined)
    ws.memberWorkspaceIds = def.memberWorkspaceIds;
  if (def.lastActiveMemberWorkspaceId !== undefined)
    ws.lastActiveMemberWorkspaceId = def.lastActiveMemberWorkspaceId;
  if (def.color !== undefined) ws.color = def.color;
  if (def.path !== undefined) ws.path = def.path;
  if (def.isGit !== undefined) ws.isGit = def.isGit;
  if (def.locked !== undefined) ws.locked = def.locked;
  if (def.createdAt !== undefined) ws.createdAt = def.createdAt;
  if (def.worktree !== undefined) ws.worktree = def.worktree;

  workspaces.update(list => [...list, ws]);
  // Members live nested inside their anchor's group and never get a row.
  // Anchors get a `kind: "workspace"` row. During restore the row order is
  // seeded separately from the persisted `workspaceOrder`, so skip the append
  // (appendWorkspaceRow is idempotent, but skipping avoids reordering rows the
  // bootstrap is about to install).
  if (!opts.restoring && !isWorkspaceMember(ws)) {
    appendWorkspaceRow({ kind: "workspace", id: ws.id });
  }
  // During restore the boot path switches to the persisted active workspace
  // once every workspace is in the store; auto-switching here would thrash.
  if (!opts.restoring) {
    activeWorkspaceIdx.set(get(workspaces).length - 1);
  }
  schedulePersist();
  const ap = findPaneInWorkspace(ws, ws.activePaneId ?? "");
  const as_ = ap?.surfaces.find(s => s.id === ap.activeSurfaceId);
  if (!opts.restoring) safeFocus(as_);
}

export function switchWorkspace(idx: number) {
  if (idx < 0 || idx >= get(workspaces).length) return;
  activeWorkspaceIdx.set(idx);
  safeFocus(get(activeSurface));
}

export function closeWorkspace(idx: number) {
  const wsList = get(workspaces);
  if (wsList.length <= 1) return;
  const ws = wsList[idx];
  for (const pane of getAllPanes(ws.splitRoot)) {
    pane.resizeObserver?.disconnect();
  }
  for (const s of getAllSurfaces(ws)) {
    if (isTerminalSurface(s)) {
      s.terminal.dispose();
      if (s.ptyId >= 0) {
        invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
      }
    }
  }
  // Group-safe close (mirrors the pane-service last-pane-close back-edge):
  // closing an anchor that still owns members must not strand them. Promote
  // the first member to anchor BEFORE removing the workspace so the tag/order
  // swap sees the closed anchor still present. The promote handles the row
  // swap; for a memberless anchor (or a member) we drop the row below.
  let promotedId: string | null = null;
  if (isAnchorWorkspace(ws)) {
    promotedId = promoteMemberToAnchor(ws.id);
  }
  workspaces.update(list => list.filter((w) => w.id !== ws.id));
  // Members never had a row; for anchors with no promote this drops the row.
  if (promotedId === null) {
    removeWorkspaceRow({ kind: "workspace", id: ws.id });
  }
  // A closed member must be detached from its anchor's ordered member list.
  if (isWorkspaceMember(ws)) removeMemberFromAllGroups(ws.id);
  activeWorkspaceIdx.set(Math.min(get(activeWorkspaceIdx), get(workspaces).length - 1));
  schedulePersist();
}

export function renameWorkspace(idx: number, name: string) {
  workspaces.update(list => {
    list[idx].name = name;
    return [...list];
  });
  schedulePersist();
}

/**
 * Patch arbitrary fields onto the workspace with the given id. The single
 * id-keyed mutator for non-structural edits (color, lock, isGit, ...);
 * schedules a persist.
 */
export function updateWorkspace(id: string, patch: Partial<Workspace>): void {
  let changed = false;
  const next = get(workspaces).map((w) => {
    if (w.id !== id) return w;
    changed = true;
    return { ...w, ...patch };
  });
  if (!changed) return;
  setWorkspaces(next);
}

export function reorderWorkspaces(fromIdx: number, toIdx: number) {
  workspaces.update(list => {
    const item = list.splice(fromIdx, 1)[0];
    const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
    list.splice(adjustedTo, 0, item);
    return [...list];
  });
  if (get(activeWorkspaceIdx) === fromIdx) {
    activeWorkspaceIdx.set(fromIdx < toIdx ? toIdx - 1 : toIdx);
  }
  schedulePersist();
}

// ---------------------------------------------------------------------------
// Grouping operations
//
// Membership is ALWAYS derived from the member's `anchorWorkspaceId` tag.
// `memberWorkspaceIds` on an anchor records ORDER only; it is rebuilt from the
// tags on launch (`reclaimGroupMembers`). Standalone workspaces are degenerate
// anchors (no members). Members never own a workspace-order row.
// ---------------------------------------------------------------------------

/**
 * Every workspace tagged with `anchorWorkspaceId === anchorId`. The canonical
 * membership query — derived from the tag, NOT from the anchor's
 * `memberWorkspaceIds` (which is ordering only).
 */
export function getMembersOfGroup(anchorId: string): Workspace[] {
  return get(workspaces).filter((w) => w.anchorWorkspaceId === anchorId);
}

/**
 * Append `memberId` to `anchorId`'s group: tag the member with its anchor,
 * append it to the anchor's ordered `memberWorkspaceIds`, and drop the
 * member's own sidebar row (members nest inside the anchor's group). No-op
 * when either workspace is missing. Idempotent.
 */
export function addMemberToGroup(anchorId: string, memberId: string): boolean {
  const list = get(workspaces);
  const anchor = list.find((w) => w.id === anchorId);
  const member = list.find((w) => w.id === memberId);
  if (!anchor || !member || anchorId === memberId) return false;
  if ((anchor.memberWorkspaceIds ?? []).includes(memberId)) return false;

  const next = list.map((w) => {
    if (w.id === anchorId) {
      return {
        ...w,
        memberWorkspaceIds: [...(w.memberWorkspaceIds ?? []), memberId],
      };
    }
    if (w.id === memberId) {
      return { ...w, anchorWorkspaceId: anchorId };
    }
    return w;
  });
  setWorkspaces(next);
  // A member nests inside its anchor's group and never owns a top-level row.
  removeWorkspaceRow({ kind: "workspace", id: memberId });
  return true;
}

/**
 * Strip `memberId` from every anchor's `memberWorkspaceIds` list. Membership
 * is derived from the tag, so this sweep only fixes the ordering arrays; the
 * caller clears the tag (e.g. on promote) or removes the workspace (on close).
 * Idempotent.
 */
export function removeMemberFromAllGroups(memberId: string): void {
  const next = get(workspaces).map((w) => {
    const members = w.memberWorkspaceIds;
    if (!members || !members.includes(memberId)) return w;
    return { ...w, memberWorkspaceIds: members.filter((id) => id !== memberId) };
  });
  setWorkspaces(next);
}

/**
 * Reorder a group's ordered member list, moving the member at `from` to `to`.
 * Indices are into the anchor's `memberWorkspaceIds`. No-op when the anchor is
 * missing or the indices are out of range.
 */
export function reorderMembers(anchorId: string, from: number, to: number): void {
  const list = get(workspaces);
  const anchor = list.find((w) => w.id === anchorId);
  if (!anchor) return;
  const members = [...(anchor.memberWorkspaceIds ?? [])];
  if (from < 0 || from >= members.length) return;
  const [item] = members.splice(from, 1);
  if (item === undefined) return;
  const insertAt = to > from ? to - 1 : to;
  members.splice(Math.max(0, Math.min(members.length, insertAt)), 0, item);
  const next = list.map((w) =>
    w.id === anchorId ? { ...w, memberWorkspaceIds: members } : w,
  );
  setWorkspaces(next);
}

/**
 * Create a group around an existing standalone workspace by adding a member.
 * The anchor is just a plain workspace; this is sugar over `addMemberToGroup`
 * that makes the intent ("start a group here") explicit at call sites.
 */
export function createGroupWithAnchor(anchorId: string, firstMemberId: string): boolean {
  return addMemberToGroup(anchorId, firstMemberId);
}

/**
 * Back-edge for closing/emptying an anchor that still owns members (RESOLVED).
 *
 * Promote the FIRST entry of the anchor's `memberWorkspaceIds` to be the new
 * anchor: clear its `anchorWorkspaceId`, retag the remaining members to point
 * at it, transfer the ordered member list (minus the promoted member), and
 * swap the closed anchor's `workspaceOrder` row id for the new anchor's id so
 * the group keeps its sidebar position. Returns the promoted member's id, or
 * null when the anchor has no members (the group simply vanishes).
 *
 * Membership is tag-derived, so the only state to reconcile is the tag on each
 * surviving member plus the new anchor's ordering array and its sidebar row.
 */
export function promoteMemberToAnchor(anchorId: string): string | null {
  const list = get(workspaces);
  const anchor = list.find((w) => w.id === anchorId);
  // Derive members from tags (canonical) but keep the anchor's recorded order.
  const taggedMembers = list.filter((w) => w.anchorWorkspaceId === anchorId);
  if (taggedMembers.length === 0) return null;

  const ordered = anchor?.memberWorkspaceIds ?? [];
  const taggedIds = new Set(taggedMembers.map((w) => w.id));
  // Preserve recorded order; append any tagged-but-unordered members.
  const orderedIds = [
    ...ordered.filter((id) => taggedIds.has(id)),
    ...taggedMembers.map((w) => w.id).filter((id) => !ordered.includes(id)),
  ];
  const newAnchorId = orderedIds[0];
  if (newAnchorId === undefined) return null;
  const remainingMemberIds = orderedIds.slice(1);

  const next = list.map((w) => {
    if (w.id === newAnchorId) {
      // Promoted member becomes a standalone/anchor workspace.
      const { anchorWorkspaceId, ...rest } = w;
      void anchorWorkspaceId;
      return {
        ...rest,
        memberWorkspaceIds: remainingMemberIds,
      };
    }
    if (remainingMemberIds.includes(w.id)) {
      return { ...w, anchorWorkspaceId: newAnchorId };
    }
    return w;
  });
  setWorkspaces(next);

  // The new anchor inherits the closed anchor's sidebar position. Insert the
  // new anchor's row where the old one sat, then drop the old row.
  const order = get(workspaceOrder);
  const at = order.findIndex(
    (r) => r.kind === "workspace" && r.id === anchorId,
  );
  insertWorkspaceRow(at < 0 ? order.length : at, {
    kind: "workspace",
    id: newAnchorId,
  });
  removeWorkspaceRow({ kind: "workspace", id: anchorId });
  return newAnchorId;
}

/**
 * Rebuild every anchor's `memberWorkspaceIds` from the canonical
 * `anchorWorkspaceId` tags. Called on launch after workspaces are restored:
 * ordering arrays are recomputed from the tags so a stale or missing list
 * self-heals. Preserves any existing recorded order, appending tagged members
 * not yet present.
 */
export function reclaimGroupMembers(): void {
  const list = get(workspaces);
  const ids = new Set(list.map((w) => w.id));

  const membersByAnchor = new Map<string, string[]>();
  for (const ws of list) {
    const anchorId = ws.anchorWorkspaceId;
    if (typeof anchorId !== "string" || !ids.has(anchorId)) continue;
    const arr = membersByAnchor.get(anchorId) ?? [];
    arr.push(ws.id);
    membersByAnchor.set(anchorId, arr);
  }

  let changed = false;
  const next = list.map((w) => {
    const tagged = membersByAnchor.get(w.id);
    if (tagged === undefined) {
      // No tagged members. If a stale list lingers, clear it.
      if (w.memberWorkspaceIds && w.memberWorkspaceIds.length > 0) {
        changed = true;
        return { ...w, memberWorkspaceIds: [] };
      }
      return w;
    }
    const taggedSet = new Set(tagged);
    const current = (w.memberWorkspaceIds ?? []).filter((id) =>
      taggedSet.has(id),
    );
    const existing = new Set(current);
    const fresh = tagged.filter((id) => !existing.has(id));
    const merged = [...current, ...fresh];
    const same =
      merged.length === (w.memberWorkspaceIds ?? []).length &&
      merged.every((id, i) => id === w.memberWorkspaceIds?.[i]);
    if (same) return w;
    changed = true;
    return { ...w, memberWorkspaceIds: merged };
  });

  if (changed) setWorkspaces(next);
}

/**
 * Ensure every anchor (a workspace with no `anchorWorkspaceId`) owns a
 * top-level sidebar row. Promotes any anchor-less workspace missing from the
 * `workspaceOrder` into a row. Members are skipped — they nest inside their
 * anchor's group. Idempotent (appendWorkspaceRow dedups).
 */
export function materializeStandaloneAnchors(): void {
  for (const ws of get(workspaces)) {
    if (isWorkspaceMember(ws)) continue;
    appendWorkspaceRow({ kind: "workspace", id: ws.id });
  }
}

/**
 * Startup reconciliation — called after workspaces are restored. Promotes
 * every anchor-less workspace to a sidebar row. Membership is derived directly
 * from `anchorWorkspaceId`, so no parallel registry needs rehydrating.
 *
 * Idempotent.
 */
export function reconcilePrimaryWorkspaces(): void {
  materializeStandaloneAnchors();
}

export function serializeLayout(node: SplitNode): LayoutNode {
  if (node.type === "pane") {
    const surfaces = node.pane.surfaces.map(s => {
      const def: any = { type: isTerminalSurface(s) ? "terminal" : "markdown" };
      if (s.title) def.name = s.title;
      if (isTerminalSurface(s) && s.cwd) def.cwd = s.cwd;
      if (s.id === node.pane.activeSurfaceId) def.focus = true;
      if (!isTerminalSurface(s) && "filePath" in s) def.path = s.filePath;
      return def;
    });
    return { pane: { surfaces } };
  }
  return {
    direction: node.direction,
    split: node.ratio,
    children: [serializeLayout(node.children[0]), serializeLayout(node.children[1])],
  };
}

export async function saveCurrentWorkspace() {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const surface = get(activeSurface);
  const name = await showInputPrompt("Workspace name", ws.name);
  if (!name) return;
  const layout = serializeLayout(ws.splitRoot);
  const activeCwd = surface && isTerminalSurface(surface) ? surface.cwd : undefined;
  const wsDef: WorkspaceDef = { name, cwd: activeCwd || "~", layout };
  const config = getConfig();
  const commands = config.commands || [];
  const existing = commands.findIndex(c => c.name === name);
  const entry = { name, workspace: wsDef };
  if (existing >= 0) {
    commands[existing] = entry;
  } else {
    commands.push(entry);
  }
  await saveConfig({ commands });
}
