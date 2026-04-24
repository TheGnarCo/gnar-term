/**
 * Extension system constants — command allowlists, permission sets, path
 * restrictions, and cleanup registry.
 *
 * Extracted from extension-loader.ts for readability. These are the security
 * boundaries of the extension sandbox.
 */
import { type AppEventType } from "./event-bus";
import { unregisterBySource } from "./command-registry";
import { unregisterSidebarTabsBySource } from "./sidebar-tab-registry";
import { unregisterTitleBarButtonsBySource } from "./titlebar-button-registry";
import { unregisterSidebarSectionsBySource } from "./sidebar-section-registry";
import { unregisterSurfaceTypesBySource } from "./surface-type-registry";
import { unregisterContextMenuItemsBySource } from "./context-menu-item-registry";
import { unregisterWorkspaceActionsBySource } from "./workspace-action-registry";
import { unregisterDashboardTabsBySource } from "./dashboard-tab-registry";
import { unregisterOverlaysBySource } from "./overlay-registry";
import { unclaimBySource } from "./claimed-workspace-registry";
import { unregisterStatusBySource } from "./status-registry";
import { unregisterWorkspaceSubtitlesBySource } from "./workspace-subtitle-registry";
import { unregisterRootRowRenderersBySource } from "./root-row-renderer-registry";
import { unregisterThemesBySource } from "./theme-registry";
import { unregisterMarkdownComponentsBySource } from "./markdown-component-registry";
import { unregisterChildRowContributorsBySource } from "./child-row-contributor-registry";
import { unregisterDashboardContributionsBySource } from "./dashboard-contribution-registry";
import { unregisterPseudoWorkspacesBySource } from "./pseudo-workspace-registry";
import { unregisterMcpToolsBySource } from "./mcp-server";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

// --- Tauri commands safe for extension use (allowlist) ---

export const EXTENSION_ALLOWED_COMMANDS: Set<string> = new Set([
  "file_exists",
  "list_dir",
  "read_file",
  "read_file_base64",
  "write_file",
  "ensure_dir",
  "remove_dir",
  "get_home",
  "is_git_repo",
  "list_gitignored",
  "watch_file",
  "unwatch_file",
  "show_in_file_manager",
  "open_with_default_app",
  "open_url",
  "find_file",
  // Git worktree commands
  "create_worktree",
  "remove_worktree",
  "list_worktrees",
  "list_branches",
  // Git operation commands
  "git_clone",
  "push_branch",
  "delete_branch",
  "git_checkout",
  // (copy_files moved to FILESYSTEM_COMMANDS — requires "filesystem" permission)
  // GitHub CLI commands
  "gh_list_issues",
  "gh_list_prs",
  "gh_available",
  // Git info commands
  "git_log",
  "git_status",
  "git_diff",
  "git_merge",
  "git_remote_url",
  // Claude settings commands
  "read_claude_file",
  "write_claude_file",
  "list_claude_dir",
  "watch_claude_file",
  "unwatch_claude_file",
]);

// PTY commands — only available to extensions with "pty" permission
export const PTY_COMMANDS: Set<string> = new Set([
  "spawn_pty",
  "write_pty",
  "kill_pty",
  "resize_pty",
  "get_pty_cwd",
  "get_pty_title",
  "pause_pty",
  "resume_pty",
]);

// Shell commands — only available to extensions with "shell" permission
// Separated from PTY because run_script allows arbitrary command execution,
// while PTY commands only interact with an existing terminal session.
export const SHELL_COMMANDS: Set<string> = new Set(["run_script"]);

// Filesystem commands — only available to extensions with "filesystem" permission
// Separated from the base allowlist because copy_files operates on arbitrary paths.
export const FILESYSTEM_COMMANDS: Set<string> = new Set(["copy_files"]);

// Observe permission — allows read-only access to terminal PTY output.
// Does not grant PTY write access. Used by extensions that detect process
// signatures (e.g., AI agent detection) without controlling terminals.
export const OBSERVE_PERMISSION = "observe";

// Every valid value accepted in a manifest's `permissions` array. Used by
// extension-validator to reject unknown permission names instead of letting
// them silently drop at the Set lookup site.
export const VALID_PERMISSIONS: Set<string> = new Set([
  "pty",
  "shell",
  "filesystem",
  OBSERVE_PERMISSION,
]);

// Commands that accept a `path` arg — blocked from accessing app config
export const PATH_COMMANDS: Set<string> = new Set([
  "file_exists",
  "list_dir",
  "read_file",
  "read_file_base64",
  "write_file",
  "ensure_dir",
  "remove_dir",
  "watch_file",
  "find_file",
]);

// Block extension access to the app's own config directory.
// This cannot be done in Rust's validate_read_path because core app code
// also uses those commands to load config/state.
// Derived at runtime from getHome() so it works regardless of home dir path.
const BLOCKED_APP_DIR_SUFFIX = "/.config/gnar-term";
let _blockedAppDir: string | undefined;

export async function getBlockedAppDir(): Promise<string> {
  if (!_blockedAppDir) {
    const home = await tauriInvoke<string>("get_home");
    _blockedAppDir = `${home}${BLOCKED_APP_DIR_SUFFIX}`;
  }
  return _blockedAppDir;
}

export function resetBlockedAppDir(): void {
  _blockedAppDir = undefined;
}

export function isBlockedAppPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  // Fast check using the suffix — works before getHome resolves
  if (normalized.includes(BLOCKED_APP_DIR_SUFFIX)) return true;
  // Exact check against resolved home dir (if available)
  if (_blockedAppDir && normalized.startsWith(_blockedAppDir)) return true;
  return false;
}

/**
 * All registry source-cleanup functions. When an extension is deactivated,
 * each function is called with the extension's id. Add new registries here
 * instead of editing cleanupExtensionResources().
 */
export const REGISTRY_CLEANUP_FNS: Array<(source: string) => void> = [
  unregisterBySource,
  unregisterSidebarTabsBySource,
  unregisterTitleBarButtonsBySource,
  unregisterSidebarSectionsBySource,
  unregisterSurfaceTypesBySource,
  unregisterContextMenuItemsBySource,
  unregisterWorkspaceActionsBySource,
  unregisterDashboardTabsBySource,
  unregisterOverlaysBySource,
  unclaimBySource,
  unregisterStatusBySource,
  unregisterWorkspaceSubtitlesBySource,
  unregisterRootRowRenderersBySource,
  unregisterThemesBySource,
  unregisterMarkdownComponentsBySource,
  unregisterChildRowContributorsBySource,
  unregisterDashboardContributionsBySource,
  unregisterPseudoWorkspacesBySource,
  unregisterMcpToolsBySource,
];

// --- Valid event types (for manifest validation) ---

const VALID_EVENT_LIST: AppEventType[] = [
  "workspace:created",
  "workspace:activated",
  "workspace:closed",
  "workspace:renamed",
  "pane:split",
  "pane:closed",
  "pane:focused",
  "surface:created",
  "surface:activated",
  "surface:closed",
  "surface:titleChanged",
  "sidebar:toggled",
  "theme:changed",
  "worktree:merged",
  "agent:statusChanged",
  "surface:ptyReady",
];
export const VALID_EVENTS: Set<string> = new Set(VALID_EVENT_LIST);
