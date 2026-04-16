/**
 * GnarTerm Extension API — public contract for extension developers.
 *
 * This file is self-contained (only depends on svelte/store). External
 * extension authors can copy this file into their project for type safety:
 *
 *   curl -O https://raw.githubusercontent.com/TheGnarCo/gnar-term/main/src/extensions/api.ts
 *
 * Extensions are loaded at runtime via dynamic import(). They must
 * export a default function matching ExtensionRegisterFn.
 */
import type { Readable } from "svelte/store";

// --- Status types (inlined so api.ts stays self-contained) ---

export interface StatusItem {
  id: string;
  source: string;
  workspaceId: string;
  category: string;
  priority: number;
  label: string;
  icon?: string;
  tooltip?: string;
  variant?: "default" | "success" | "warning" | "error" | "muted";
  action?: {
    command: string;
    args?: unknown[];
  };
  metadata?: Record<string, unknown>;
}

export type StatusItemInput = Omit<StatusItem, "id" | "source" | "workspaceId">;

// --- Event types (for api.on/off) ---

export type AppEventType =
  | "workspace:created"
  | "workspace:activated"
  | "workspace:closed"
  | "workspace:renamed"
  | "pane:split"
  | "pane:closed"
  | "pane:focused"
  | "surface:created"
  | "surface:activated"
  | "surface:closed"
  | "surface:titleChanged"
  | "sidebar:toggled"
  | "theme:changed";

/** Base shape for all events delivered to extension handlers. */
export interface AppEvent {
  type: AppEventType;
  [key: string]: unknown;
}

// --- Manifest types (extension.json) ---

export interface ExtensionManifestAction {
  id: string;
  icon: string;
  title: string;
}

export interface ExtensionManifestTab {
  id: string;
  label: string;
  icon?: string;
  actions?: ExtensionManifestAction[];
}

export interface ExtensionManifestSection {
  id: string;
  label: string;
}

export interface ExtensionManifestCommand {
  id: string;
  title: string;
}

export interface ExtensionManifestSurface {
  id: string;
  label: string;
}

export interface ExtensionManifestContextMenu {
  id: string;
  label: string;
  when: string; // glob: "*", "*.md", "*.{png,jpg}"
}

export interface ExtensionSettingsField {
  type: "string" | "number" | "boolean" | "select";
  title: string;
  description?: string;
  default?: string | number | boolean;
  options?: Array<{ label: string; value: string }>; // for "select" type
}

export interface ExtensionSettingsSchema {
  fields: Record<string, ExtensionSettingsField>;
}

export interface ExtensionManifestWorkspaceAction {
  id: string;
  title: string;
}

export interface ExtensionContributions {
  secondarySidebarTabs?: ExtensionManifestTab[];
  primarySidebarSections?: ExtensionManifestSection[];
  commands?: ExtensionManifestCommand[];
  surfaces?: ExtensionManifestSurface[];
  contextMenuItems?: ExtensionManifestContextMenu[];
  workspaceActions?: ExtensionManifestWorkspaceAction[];
  events?: string[];
  settings?: ExtensionSettingsSchema;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  entry: string;
  included?: boolean;
  /** Elevated permissions (e.g., ["pty"] for PTY access) */
  permissions?: string[];
  contributes?: ExtensionContributions;
}

// --- Extension API (passed to register()) ---

export interface ExtensionStateAPI {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

/**
 * The API object passed to an extension's register function.
 * This is the only interface between an extension and the host.
 * Extensions must NOT import from core paths or @tauri-apps/api directly.
 */
export interface ExtensionAPI {
  // Lifecycle — must be called synchronously during register(), not in async callbacks
  onActivate(callback: () => void | Promise<void>): void;
  onDeactivate(callback: () => void): void;

  // Event bus (filtered to declared events in manifest)
  // Accepts both core AppEventType and "extension:*" custom events
  on(
    event: AppEventType | `extension:${string}`,
    handler: (payload: AppEvent) => void,
  ): void;
  off(
    event: AppEventType | `extension:${string}`,
    handler: (payload: AppEvent) => void,
  ): void;
  // Emit custom events (must use "extension:" prefix)
  emit(event: `extension:${string}`, payload?: Record<string, unknown>): void;

  // UI registration — core owns chrome, extension provides content
  registerSecondarySidebarTab(tabId: string, component: unknown): void;
  registerSecondarySidebarAction(
    tabId: string,
    actionId: string,
    handler: () => void,
  ): void;
  registerPrimarySidebarSection(
    sectionId: string,
    component: unknown,
    options?: {
      collapsible?: boolean;
      showLabel?: boolean;
      label?: string;
      props?: Record<string, unknown>;
    },
  ): void;
  registerSurfaceType(surfaceId: string, component: unknown): void;
  /** Register an agent launcher that appears in the new-tab dropdown. */
  registerAgentLauncher(id: string, label: string, command: string): void;
  /** Unregister all agent launchers registered by this extension. */
  unregisterAgentLaunchers(): void;
  /** Register an overlay component (dialog, dashboard, modal) rendered above the main UI. */
  registerOverlay(
    overlayId: string,
    component: unknown,
    props?: Record<string, unknown>,
  ): void;
  /** Unregister a previously registered overlay. */
  unregisterOverlay(overlayId: string): void;
  registerDashboardTab(
    tabId: string,
    component: unknown,
    options?: { label?: string; props?: Record<string, unknown> },
  ): void;
  registerCommand(
    commandId: string,
    handler: () => void | Promise<void>,
    options?: { title?: string },
  ): void;
  registerContextMenuItem(
    itemId: string,
    handler: (filePath: string) => void,
  ): void;

  // Workspace subtitle — components rendered below workspace name in sidebar
  /** Register a Svelte component to render below workspace names. Component receives { workspaceId } prop. */
  registerWorkspaceSubtitle(component: unknown, priority?: number): void;

  // Workspace actions — buttons in the workspace header and sidebar top bar
  registerWorkspaceAction(
    actionId: string,
    options: {
      label: string;
      icon: string;
      shortcut?: string;
      /** Where the action appears: "workspace" (default) in the workspace header,
       *  "sidebar" in the top bar alongside reorder. */
      zone?: "workspace" | "sidebar";
      handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
      when?: (ctx: WorkspaceActionContext) => boolean;
    },
  ): void;
  getWorkspaceActions(): WorkspaceActionInfo[];

  // Tauri command invocation — use this instead of @tauri-apps/api/core
  invoke<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T>;

  // Actions — open surfaces, prompt user, toggle sidebar
  openFile(path: string): void;
  getActiveCwd(): Promise<string | undefined>;
  pickDirectory(title?: string): Promise<string | null>;
  showInputPrompt(label: string, defaultValue?: string): Promise<string | null>;
  showFormPrompt(
    title: string,
    fields: Array<{
      key: string;
      label: string;
      defaultValue?: string;
      placeholder?: string;
    }>,
  ): Promise<Record<string, string> | null>;
  toggleSecondarySidebar(): void;
  createWorkspace(
    name: string,
    cwd: string,
    options?: CreateWorkspaceOptions,
  ): void;
  /** Mark a workspace as claimed — it will not appear in the main Workspaces list. */
  claimWorkspace(workspaceId: string): void;
  /** Release a claimed workspace back to the main list. */
  unclaimWorkspace(workspaceId: string): void;
  openInEditor(filePath: string): void;
  openSurface(
    surfaceTypeId: string,
    title: string,
    props?: Record<string, unknown>,
  ): void;

  // Workspace management — switch and close by ID
  switchWorkspace(workspaceId: string): void;
  closeWorkspace(workspaceId: string): void;

  /** Set hasUnread=true on a surface tab (e.g., to signal "agent waiting"). Cleared automatically when the surface is selected. */
  markSurfaceUnread(surfaceId: string): void;
  /** Navigate to a specific surface: switches workspace, focuses pane, selects surface. No-op if surfaceId not found. */
  focusSurface(surfaceId: string): void;
  /** Resolve the owning workspace id for a surface. Returns null if the surface is not found. */
  getWorkspaceIdForSurface(surfaceId: string): string | null;
  /**
   * Surface an error to the user-visible error store. The extension's
   * failure toast will appear on next launch (or immediately if the
   * toast UI is already mounted). Use for configuration errors, observer
   * failures, or other recoverable-but-important conditions that should
   * not be silently logged.
   */
  reportError(message: string): void;
  /**
   * Enumerate every terminal surface across all workspaces and all panes
   * (active or background, split or single). Used by extensions that need
   * to bootstrap tracking for surfaces that existed before activation —
   * surface:created only fires for surfaces created AFTER the listener was
   * attached, so an extension that activates after workspace restore must
   * use this to catch up.
   */
  getAllTerminalSurfaces(): Array<{
    id: string;
    workspaceId: string;
    title: string;
  }>;

  // Sidebar tab indicators
  /** Set or clear a notification badge dot on a secondary sidebar tab. */
  badgeSidebarTab(tabId: string, hasBadge: boolean): void;
  /** Programmatically switch to a secondary sidebar tab (opens sidebar if closed). */
  activateSidebarTab(tabId: string): void;
  /** Set or clear a status indicator on a workspace item (e.g., "running" | "waiting" | "idle" | null to clear). */
  setWorkspaceIndicator(workspaceId: string, status: string | null): void;

  // Status registry — structured workspace status items
  /** Set a status item for a workspace, scoped to this extension. */
  setStatus(workspaceId: string, itemId: string, status: StatusItemInput): void;
  /** Clear a specific status item. */
  clearStatus(workspaceId: string, itemId: string): void;
  /** Clear all status items for a workspace from this extension. */
  clearAllStatus(workspaceId: string): void;
  /** Subscribe to all status items for a workspace (from all sources). */
  getWorkspaceStatus(workspaceId: string): Readable<StatusItem[]>;
  /** Subscribe to status items for a workspace filtered by category. */
  getWorkspaceStatusByCategory(
    workspaceId: string,
    category: string,
  ): Readable<StatusItem[]>;

  // Context menus — show a menu with items from all extensions matching the target
  showFileContextMenu(x: number, y: number, filePath: string): void;
  showDirContextMenu(x: number, y: number, dirPath: string): void;

  // Clipboard
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;

  // Desktop notifications
  /** Send a desktop notification. Requests permission automatically on first call. */
  sendNotification(title: string, body?: string): Promise<void>;

  // Asset URL conversion — use this instead of @tauri-apps/api/core convertFileSrc
  convertFileSrc(path: string): string;

  // Terminal output observation (requires "observe" permission)
  /** Subscribe to raw PTY output for a terminal surface. Returns unsubscribe function. No-ops for non-terminal surfaces. */
  onSurfaceOutput(
    surfaceId: string,
    callback: (data: string) => void,
  ): () => void;

  // File watching — listen for changes from watch_file command
  onFileChanged(
    watchId: number,
    handler: (event: {
      watchId: number;
      path: string;
      content: string;
    }) => void,
  ): () => void; // returns unsubscribe function

  // Scoped state
  state: ExtensionStateAPI;

  // Extension settings (declared via manifest contributes.settings)
  getSetting<T = unknown>(key: string): T | undefined;
  getSettings(): Record<string, unknown>;

  // Read-only core state (Svelte readable stores)
  workspaces: Readable<WorkspaceRef[]>;
  activeWorkspace: Readable<WorkspaceRef | null>;
  activePane: Readable<PaneRef | null>;
  activeSurface: Readable<SurfaceRef | null>;
  theme: Readable<{
    bg: string;
    fg: string;
    fgDim: string;
    accent: string;
    border: string;
    [key: string]: string;
  }>;
  settings: Readable<Record<string, unknown>>;

  // Dashboard zone helpers — query mountable content from registries
  getSidebarTabs(): Array<{ id: string; label: string; component: unknown }>;
  getSidebarSections(): Array<{
    id: string;
    label: string;
    component: unknown;
  }>;
  getDashboardTabs(): Array<{
    id: string;
    label: string;
    component: unknown;
    props?: Record<string, unknown>;
  }>;

  /**
   * Shared UI components — use these instead of importing core internals.
   *
   * - **WorkspaceListView** — renders workspace items with full interaction
   *   Props: `{ filterIds?: Set<string>, accentColor?: string }`
   * - **SplitButton** — primary action + dropdown caret for secondary actions
   *   Props: `{ label, onMainClick, dropdownItems, theme }`
   * - **ColorPicker** — grid of color swatches with selection state
   *   Props: `{ theme: Readable<ThemeDef>, value: string (bindable), colors?: string[] }`
   */
  getComponents(): {
    WorkspaceListView: unknown;
    SplitButton: unknown;
    ColorPicker: unknown;
  };
}

// --- Workspace action types ---

/**
 * Context passed to workspace action handlers and `when` filters.
 *
 * Core passes an empty context `{}` for top-level actions. Extensions
 * may populate additional fields (e.g., project or git metadata) when
 * invoking actions from their own UI. Use optional chaining to access
 * extension-provided fields safely.
 */
export interface WorkspaceActionContext {
  [key: string]: unknown;
}

export interface WorkspaceActionInfo {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  zone?: "workspace" | "sidebar";
  handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
  when?: (ctx: WorkspaceActionContext) => boolean;
}

// --- Workspace creation options ---

export interface CreateWorkspaceOptions {
  /** Environment variables to set on the workspace's terminal PTY */
  env?: Record<string, string>;
  /** Arbitrary metadata stored alongside the workspace (e.g., branch, worktreePath) */
  metadata?: Record<string, unknown>;
}

// --- Git operation result types ---

/** Result of a git_merge Tauri command invocation. */
export interface MergeResult {
  success: boolean;
  message: string;
  conflicts?: string[];
}

// --- Public-facing core state types (stable subset for extensions) ---

export interface WorkspaceRef {
  id: string;
  name: string;
}

export interface SurfaceRef {
  id: string;
  kind: string;
  title: string;
  hasUnread: boolean;
}

export interface PaneRef {
  id: string;
  surfaces: SurfaceRef[];
  activeSurfaceId: string | null;
}

/** Shape of a surface created by an extension, as delivered to surface components. */
export interface ExtensionSurfacePayload {
  kind: "extension";
  id: string;
  surfaceTypeId: string;
  title: string;
  hasUnread: boolean;
  props?: Record<string, unknown>;
  dispose?: () => void;
}

// --- Extension entry point ---

export type ExtensionRegisterFn = (api: ExtensionAPI) => void | Promise<void>;

// --- Context helper ---

/**
 * Context key used by GnarTerm to inject the ExtensionAPI into Svelte components.
 * Use with Svelte's getContext() in your component's <script> block:
 *
 *   import { getContext } from "svelte";
 *   import { EXTENSION_API_KEY, type ExtensionAPI } from "./api";
 *   const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
 */
export const EXTENSION_API_KEY = "gnar-term:extension-api";

// --- Tauri command types (for use with api.invoke()) ---

/**
 * Directory entry returned by the "list_dir" command.
 */
export interface DirEntry {
  name: string;
  is_dir: boolean;
  is_hidden: boolean;
}

/**
 * Available Tauri commands for extensions via api.invoke().
 *
 * All file system commands validate paths — reads to ~/.ssh, ~/.gnupg, ~/.aws,
 * ~/.kube, ~/.config/gcloud, and ~/.docker are blocked.
 * Writes are restricted to ~/.config/gnar-term/.
 * Note: most system paths (e.g. /etc/hosts) are allowed for reads.
 * Exceptions: /etc/shadow and /etc/gshadow are blocked.
 *
 * Usage:
 *   const entries = await api.invoke<DirEntry[]>("list_dir", { path: "/tmp" });
 *
 * Commands:
 *
 *   File System:
 *     "file_exists"    { path: string }                    → boolean
 *     "list_dir"       { path: string }                    → DirEntry[]
 *     "read_file"      { path: string }                    → string
 *     "read_file_base64" { path: string }                  → string (base64)
 *     "write_file"     { path: string, content: string }   → void (restricted to ~/.config/gnar-term/)
 *     "ensure_dir"     { path: string }                    → void (restricted to ~/.config/gnar-term/)
 *     "remove_dir"     { path: string }                    → void (restricted to ~/.config/gnar-term/)
 *     "get_home"       {}                                  → string
 *
 *   Git:
 *     "is_git_repo"    { path: string }                    → boolean
 *     "list_gitignored" { path: string }                   → string[]
 *
 *   File Watching:
 *     "watch_file"     { path: string }                    → number (watchId)
 *     "unwatch_file"   { watchId: number }                 → void
 *     Use api.onFileChanged(watchId, handler) to receive change events.
 *
 *   Git Worktree:
 *     "create_worktree" { repoPath: string, branch: string, base: string, worktreePath: string } → void
 *     "remove_worktree" { repoPath: string, worktreePath: string } → void
 *     "list_worktrees"  { repoPath: string }               → WorktreeInfo[]
 *     "list_branches"   { repoPath: string, includeRemote: boolean } → BranchInfo[]
 *
 *   Git Operations:
 *     "git_clone"       { url: string, targetDir: string }  → void
 *     "push_branch"     { repoPath: string, branch: string, remote?: string } → void
 *     "delete_branch"   { repoPath: string, branch: string, remote?: boolean } → void
 *     "git_checkout"    { repoPath: string, branch: string } → void
 *     "git_log"         { repoPath: string, count?: number } → CommitInfo[]
 *     "git_status"      { repoPath: string }                → FileStatus[]
 *     "git_diff"        { repoPath: string, file?: string, base?: string, head?: string } → string
 *     "git_merge"       { repoPath: string, branch: string } → MergeResult
 *
 *   GitHub CLI:
 *     "gh_list_issues"  { repoPath: string, state?: string } → GhIssue[]
 *     "gh_list_prs"     { repoPath: string, state?: string } → GhPr[]
 *
 *   File Utilities (requires permissions):
 *     "copy_files"      { sourceDir: string, destDir: string, patterns: string[] } → number  (requires "filesystem")
 *     "run_script"      { cwd: string, command: string }   → ScriptOutput  (requires "shell")
 *
 *   System:
 *     "show_in_file_manager" { path: string }              → void
 *     "open_with_default_app" { path: string }             → void
 *     "find_file"      { name: string }                    → string
 *
 *   PTY (requires "pty" permission):
 *     "spawn_pty"       { cwd: string, ... }               → number (ptyId)
 *     "write_pty"       { id: number, data: string }       → void
 *     "kill_pty"        { id: number }                     → void
 *     "resize_pty"      { id: number, cols: number, rows: number } → void
 *     "get_pty_cwd"     { id: number }                     → string
 *     "get_pty_title"   { id: number }                     → string
 *     "pause_pty"       { id: number }                     → void
 *     "resume_pty"      { id: number }                     → void
 */
