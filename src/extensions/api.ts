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
  on(event: string, handler: (payload: AppEvent) => void): void;
  off(event: string, handler: (payload: AppEvent) => void): void;
  // Emit custom events (must use "extension:" prefix)
  emit(event: string, payload?: Record<string, unknown>): void;

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
  registerCommand(commandId: string, handler: () => void | Promise<void>): void;
  registerContextMenuItem(
    itemId: string,
    handler: (filePath: string) => void,
  ): void;

  // Workspace actions — buttons in the workspace header and project sections
  registerWorkspaceAction(
    actionId: string,
    options: {
      label: string;
      icon: string;
      shortcut?: string;
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
  toggleSecondarySidebar(): void;
  createWorkspace(
    name: string,
    cwd: string,
    options?: CreateWorkspaceOptions,
  ): void;
  openInEditor(filePath: string): void;
  openSurface(
    surfaceTypeId: string,
    title: string,
    props?: Record<string, unknown>,
  ): void;

  // Context menus — show a menu with items from all extensions matching the target
  showFileContextMenu(x: number, y: number, filePath: string): void;
  showDirContextMenu(x: number, y: number, dirPath: string): void;

  // Clipboard
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;

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
}

// --- Workspace action types ---

export interface WorkspaceActionContext {
  projectId?: string;
  projectPath?: string;
  projectName?: string;
  isGit?: boolean;
}

export interface WorkspaceActionInfo {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
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
 *   System:
 *     "show_in_file_manager" { path: string }              → void
 *     "open_with_default_app" { path: string }             → void
 *     "find_file"      { name: string }                    → string
 */
