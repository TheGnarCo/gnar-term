/**
 * workspace-context-menu.ts — shared factory for workspace context menu items.
 *
 * Both WorkspaceListBlock and WorkspaceListView show a context menu with the
 * same core items (Rename, Promote, Archive, Close). They diverge only in a
 * few spots (Block adds "New Surface", View doesn't; exact close logic
 * differs). This helper captures the common shape so neither callsite needs to
 * inline the full conditional item array.
 */

import type { MenuItem } from "../context-menu-types";

export interface WorkspaceContextMenuOptions {
  /** True when the workspace is a dashboard surface (rename/promote/archive disabled). */
  isDashboard: boolean;
  /** True when the workspace is already nested inside a group (promote disabled). */
  isInsideGroup: boolean;
  /** True when the promote-workspace-to-group command is registered. */
  canPromoteCommand: boolean;
  /** Total number of workspaces in the list — used to disable "Close Workspace". */
  workspaceCount: number;

  // --- action callbacks ---
  onRename?: () => void;
  /** Called when "New Surface" is requested. Omit to exclude the item. */
  onNewSurface?: () => void;
  onPromote?: () => void;
  onArchive?: () => void;
  onClose: () => void;
}

/**
 * Build the standard workspace context-menu items array. Returns a `MenuItem[]`
 * that callers pass directly to `contextMenu.set({ x, y, items })`.
 *
 * Item presence:
 *   - "Rename Workspace"             — omitted for dashboards
 *   - "New Surface"                  — included only when `onNewSurface` is provided
 *   - separator + "Promote…"         — omitted for dashboards / grouped workspaces
 *   - separator + "Archive"          — omitted for dashboards
 *   - "Close Workspace"              — always present; disabled for dashboards or when count ≤ 1
 */
export function buildWorkspaceContextMenuItems(
  opts: WorkspaceContextMenuOptions,
): MenuItem[] {
  const {
    isDashboard,
    isInsideGroup,
    canPromoteCommand,
    workspaceCount,
    onRename,
    onNewSurface,
    onPromote,
    onArchive,
    onClose,
  } = opts;

  const canRename = !isDashboard;
  const canPromote = canPromoteCommand && !isDashboard && !isInsideGroup;
  const canArchive = !isDashboard;

  const items: MenuItem[] = [];

  if (canRename && onRename) {
    items.push({
      label: "Rename Workspace",
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

  if (canPromote && onPromote) {
    items.push({ label: "", action: () => {}, separator: true });
    items.push({
      label: "Promote to Workspace Group...",
      action: onPromote,
    });
  }

  items.push({ label: "", action: () => {}, separator: true });

  if (canArchive && onArchive) {
    items.push({
      label: "Archive",
      action: onArchive,
    });
  }

  items.push({
    label: "Close Workspace",
    shortcut: "⇧⌘W",
    danger: true,
    disabled: workspaceCount <= 1 || isDashboard,
    action: onClose,
  });

  return items;
}
