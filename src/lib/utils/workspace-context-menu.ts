/**
 * workspace-context-menu.ts — shared factory for workspace context menu items.
 *
 * Both WorkspaceListBlock and WorkspaceListView show a context menu with the
 * same core items (Rename, Archive, Close). They diverge only in a few spots
 * (Block adds "New Surface", View doesn't; exact close logic differs). This
 * helper captures the common shape so neither callsite needs to inline the
 * full conditional item array.
 */

import type { MenuItem } from "../context-menu-types";

export interface WorkspaceContextMenuOptions {
  /** True when the workspace is a dashboard surface (rename/archive disabled). */
  isDashboard: boolean;
  /** Total number of workspaces in the list — used to disable "Close Branched Workspace". */
  workspaceCount: number;
  /**
   * True when the workspace is currently locked (metadata.locked === true).
   * Drives the Lock/Unlock label and disables Close while locked.
   */
  isLocked?: boolean;

  // --- action callbacks ---
  onRename?: () => void;
  /** Called when "New Surface" is requested. Omit to exclude the item. */
  onNewSurface?: () => void;
  onArchive?: () => void;
  /**
   * Called when the user toggles "Lock Branched Workspace" / "Unlock Branched Workspace".
   * Omit to exclude the item entirely (e.g. for dashboards).
   */
  onToggleLock?: () => void;
  onClose: () => void;
}

/**
 * Build the standard workspace context-menu items array. Returns a `MenuItem[]`
 * that callers pass directly to `contextMenu.set({ x, y, items })`.
 *
 * Item presence:
 *   - "Rename Branched Workspace"    — omitted for dashboards
 *   - "New Surface"                  — included only when `onNewSurface` is provided
 *   - separator + "Lock/Unlock…"     — omitted for dashboards or when no `onToggleLock`
 *   - "Archive"                      — omitted for dashboards; disabled while locked
 *   - "Close Branched Workspace"     — always present; disabled for dashboards, when
 *                                       count ≤ 1, or while locked
 */
export function buildWorkspaceContextMenuItems(
  opts: WorkspaceContextMenuOptions,
): MenuItem[] {
  const {
    isDashboard,
    workspaceCount,
    isLocked = false,
    onRename,
    onNewSurface,
    onArchive,
    onToggleLock,
    onClose,
  } = opts;

  const canRename = !isDashboard;
  const canArchive = !isDashboard;

  const items: MenuItem[] = [];

  if (canRename && onRename) {
    items.push({
      label: "Rename Branched Workspace",
      shortcut: "⇧⌘R",
      action: onRename,
    });
  }

  if (onNewSurface) {
    items.push({
      label: "New Surface",
      shortcut: "⌘T",
      action: onNewSurface,
    });
  }

  items.push({ label: "", action: () => {}, separator: true });

  if (!isDashboard && onToggleLock) {
    items.push({
      label: isLocked ? "Unlock Branched Workspace" : "Lock Branched Workspace",
      action: onToggleLock,
    });
  }

  if (canArchive && onArchive) {
    items.push({
      label: "Archive",
      disabled: isLocked,
      action: onArchive,
    });
  }

  items.push({
    label: "Close Branched Workspace",
    shortcut: "⇧⌘W",
    danger: true,
    disabled: workspaceCount <= 1 || isDashboard || isLocked,
    action: onClose,
  });

  return items;
}
