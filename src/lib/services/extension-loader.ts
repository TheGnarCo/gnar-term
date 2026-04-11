/**
 * Extension Loader — discovers, validates, and manages extension lifecycle.
 *
 * Core responsibilities:
 * - Validate extension.json manifests
 * - Construct sandboxed ExtensionAPI instances wired to core stores/services
 * - Manage activate/deactivate lifecycle with cleanup
 * - Expose a reactive store of loaded extensions
 */
import { writable, get, type Readable } from "svelte/store";
import {
  eventBus,
  type AppEventType,
  type AppEvent,
  type ExtensionEvent,
} from "./event-bus";
import {
  registerCommand as registryRegisterCommand,
  unregisterBySource,
} from "./command-registry";
import {
  registerSidebarTab,
  registerSidebarAction,
  unregisterSidebarTabsBySource,
  sidebarTabStore,
} from "./sidebar-tab-registry";
import {
  registerSidebarSection,
  unregisterSidebarSectionsBySource,
  sidebarSectionStore,
} from "./sidebar-section-registry";
import {
  registerSurfaceType as registryRegisterSurfaceType,
  unregisterSurfaceTypesBySource,
  surfaceTypeStore,
} from "./surface-type-registry";
import {
  registerContextMenuItem as registryRegisterContextMenuItem,
  unregisterContextMenuItemsBySource,
  getContextMenuItemsForFile,
  getContextMenuItemsForDir,
} from "./context-menu-item-registry";
import {
  registerWorkspaceAction as registryRegisterWorkspaceAction,
  unregisterWorkspaceActionsBySource,
  getWorkspaceActions as registryGetWorkspaceActions,
} from "./workspace-action-registry";
import { loadExtensionState, saveExtensionState } from "./extension-state";
import { closeExtensionSurfaces } from "./surface-service";
import {
  workspaces,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../stores/workspace";
import { theme } from "../stores/theme";
import {
  secondarySidebarVisible,
  pendingAction,
  contextMenu,
  showInputPrompt as coreShowInputPrompt,
} from "../stores/ui";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  readText as clipboardRead,
  writeText as clipboardWrite,
} from "@tauri-apps/plugin-clipboard-manager";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { getActiveCwd } from "./service-helpers";
import { configStore as configStoreReadable, getConfig } from "../config";
import type {
  ExtensionManifest,
  ExtensionAPI,
  ExtensionRegisterFn,
  LoadedExtension,
} from "../extension-types";

// --- Tauri commands safe for extension use (allowlist) ---

const EXTENSION_ALLOWED_COMMANDS: Set<string> = new Set([
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
  // File utility commands
  "copy_files",
  "run_script",
  // GitHub CLI commands
  "gh_list_issues",
  "gh_list_prs",
  // Git info commands
  "git_log",
  "git_status",
  "git_diff",
]);

// PTY commands — only available to extensions with "pty" permission
const PTY_COMMANDS: Set<string> = new Set([
  "spawn_pty",
  "write_pty",
  "kill_pty",
  "resize_pty",
  "get_pty_cwd",
  "get_pty_title",
  "pause_pty",
  "resume_pty",
]);

// Commands that accept a `path` arg — blocked from accessing app config
const PATH_COMMANDS: Set<string> = new Set([
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

async function getBlockedAppDir(): Promise<string> {
  if (!_blockedAppDir) {
    const home = await tauriInvoke<string>("get_home");
    _blockedAppDir = `${home}${BLOCKED_APP_DIR_SUFFIX}`;
  }
  return _blockedAppDir;
}

function isBlockedAppPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  // Fast check using the suffix — works before getHome resolves
  if (normalized.includes(BLOCKED_APP_DIR_SUFFIX)) return true;
  // Exact check against resolved home dir (if available)
  if (_blockedAppDir && normalized.startsWith(_blockedAppDir)) return true;
  return false;
}

// --- Valid event types (for manifest validation) ---

// Typed as AppEventType[] so TypeScript catches drift — a new event added
// to the bus but missing here will produce a compile error.
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
];
const VALID_EVENTS: Set<string> = new Set(VALID_EVENT_LIST);

// --- Extension store ---

const _extensions = writable<LoadedExtension[]>([]);
export const extensionStore: Readable<LoadedExtension[]> = _extensions;

// API lookup by extension ID — used by ExtensionWrapper to inject context
const extensionApis = new Map<string, ExtensionAPI>();

export function getExtensionApiById(
  extensionId: string,
): ExtensionAPI | undefined {
  return extensionApis.get(extensionId);
}

// In-memory state per extension (keyed by extension id)
const extensionStateMap = new Map<string, Map<string, unknown>>();

// Debounce timers for state persistence (one per extension)
const stateDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const STATE_DEBOUNCE_MS = 300;

// Event subscriptions per extension (for cleanup on deactivate)
const extensionEventHandlers = new Map<
  string,
  Array<{ event: AppEventType; handler: (payload: AppEvent) => void }>
>();

// Tauri event listeners per extension (for cleanup on deactivate)
const extensionTauriListeners = new Map<string, Array<() => void>>();

// File watcher IDs per extension (for cleanup on deactivate)
const extensionWatchIds = new Map<string, Set<number>>();

// Global file-changed listener — shared across all extensions.
// Fans out by watchId to avoid one Tauri listener per onFileChanged call.
type FileChangedHandler = (event: {
  watchId: number;
  path: string;
  content: string;
}) => void;
const fileChangedHandlers = new Map<number, Set<FileChangedHandler>>();
let _globalFileChangedUnlisten: (() => void) | undefined;
let globalFileChangedSetup: Promise<void> | undefined;

function ensureGlobalFileChangedListener(): void {
  if (globalFileChangedSetup) return;
  globalFileChangedSetup = listen<{
    watch_id: number;
    path: string;
    content: string;
  }>("file-changed", (event) => {
    const handlers = fileChangedHandlers.get(event.payload.watch_id);
    if (handlers) {
      const mapped = {
        watchId: event.payload.watch_id,
        path: event.payload.path,
        content: event.payload.content,
      };
      for (const handler of handlers) {
        try {
          handler(mapped);
        } catch (err) {
          console.error("[extension] Error in file-changed handler:", err);
        }
      }
    }
  })
    .then((fn) => {
      _globalFileChangedUnlisten = fn;
    })
    .catch((err) => {
      console.warn(
        "[extension] Failed to set up global file-changed listener:",
        err,
      );
    });
}

// --- Manifest validation ---

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate extension id: lowercase alphanumeric with single hyphens,
 * must start and end with alphanumeric. Uses a linear scan instead of
 * regex to avoid backtracking complexity.
 */
function isValidExtensionId(id: string): boolean {
  if (id.length === 0) return false;
  for (let i = 0; i < id.length; i++) {
    const c = id[i];
    const isAlnum = (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
    const isHyphen = c === "-";
    if (!isAlnum && !isHyphen) return false;
    // First and last char must be alphanumeric; no consecutive hyphens
    if (isHyphen && (i === 0 || i === id.length - 1 || id[i - 1] === "-"))
      return false;
  }
  return true;
}

export function validateManifest(manifest: unknown): ValidationResult {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["Manifest must be an object"] };
  }

  const m = manifest as Record<string, unknown>;
  if (!m.id || typeof m.id !== "string") {
    errors.push("Missing or invalid required field: id");
  } else if (!isValidExtensionId(m.id as string)) {
    errors.push(
      'Invalid id format: must be lowercase alphanumeric with hyphens (e.g. "my-extension")',
    );
  }
  if (!m.name || typeof m.name !== "string") {
    errors.push("Missing or invalid required field: name");
  }
  if (!m.version || typeof m.version !== "string") {
    errors.push("Missing or invalid required field: version");
  }
  if (!m.entry || typeof m.entry !== "string") {
    errors.push("Missing or invalid required field: entry");
  } else {
    const entry = m.entry as string;
    if (
      entry.includes("..") ||
      entry.startsWith("/") ||
      entry.startsWith("\\")
    ) {
      errors.push(
        "Invalid entry path: must not contain '..' or start with '/' or '\\\\'",
      );
    }
  }

  // Validate declared events
  const contributes = m.contributes as Record<string, unknown> | undefined;
  if (contributes?.events) {
    for (const event of contributes.events as string[]) {
      if (!VALID_EVENTS.has(event) && !event.startsWith("extension:")) {
        errors.push(`Invalid event type: ${event}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// --- Shared helpers ---

function showContextMenuFor(
  x: number,
  y: number,
  path: string,
  getItems: (
    path: string,
  ) => Array<{ label: string; handler: (path: string) => void }>,
): void {
  const items = getItems(path).map((item) => ({
    label: item.label,
    action: () => item.handler(path),
  }));
  if (items.length > 0) {
    contextMenu.set({ x, y, items });
  }
}

// --- ExtensionAPI construction ---

export function createExtensionAPI(manifest: ExtensionManifest): {
  api: ExtensionAPI;
  getActivateCallback: () => (() => void | Promise<void>) | undefined;
  getDeactivateCallback: () => (() => void) | undefined;
} {
  const extId = manifest.id;

  // Eagerly resolve the blocked app dir so the sync check works
  getBlockedAppDir().catch(() => {});

  const declaredEvents = manifest.contributes?.events ?? [];
  const eventAllowSet = new Set(declaredEvents);

  // Build per-extension command allowlist — expand with PTY commands if permitted
  const permissions = new Set(manifest.permissions ?? []);
  const allowedCommands = new Set(EXTENSION_ALLOWED_COMMANDS);
  if (permissions.has("pty")) {
    for (const cmd of PTY_COMMANDS) allowedCommands.add(cmd);
    console.warn(
      `[extension:${extId}] Elevated permissions: PTY access granted`,
    );
  }

  // Initialize state and event tracking for this extension
  if (!extensionStateMap.has(extId)) {
    extensionStateMap.set(extId, new Map());
  }
  if (!extensionEventHandlers.has(extId)) {
    extensionEventHandlers.set(extId, []);
  }
  if (!extensionTauriListeners.has(extId)) {
    extensionTauriListeners.set(extId, []);
  }
  if (!extensionWatchIds.has(extId)) {
    extensionWatchIds.set(extId, new Set());
  }

  // Lifecycle callbacks — captured by registerExtension
  let _onActivate: (() => void | Promise<void>) | undefined;
  let _onDeactivate: (() => void) | undefined;

  // Read-only store wrappers (strip set/update from Writable)
  const readOnly = <T>(store: {
    subscribe: (fn: (v: T) => void) => () => void;
  }): Readable<T> => ({
    subscribe: store.subscribe,
  });

  // Scoped settings store — only exposes the calling extension's own settings,
  // not the full config (which would leak other extensions' paths and state).
  const settingsStore: Readable<Record<string, unknown>> = {
    subscribe(fn: (v: Record<string, unknown>) => void) {
      return configStoreReadable.subscribe((cfg) => {
        const extSettings =
          (
            cfg as Record<string, unknown> & {
              extensions?: Record<
                string,
                { settings?: Record<string, unknown> }
              >;
            }
          ).extensions?.[extId]?.settings ?? {};
        fn(extSettings);
      });
    },
  };

  const api: ExtensionAPI = {
    onActivate(callback) {
      _onActivate = callback;
    },
    onDeactivate(callback) {
      _onDeactivate = callback;
    },

    on(event: string, handler: (payload: AppEvent) => void) {
      if (!eventAllowSet.has(event)) {
        throw new Error(
          `[extension:${extId}] Event "${event}" not declared in manifest. ` +
            `Declared events: ${declaredEvents.join(", ") || "(none)"}`,
        );
      }
      if (event.startsWith("extension:")) {
        eventBus.onExtension(event, handler as (e: ExtensionEvent) => void);
      } else {
        eventBus.on(
          event as AppEventType,
          handler as Parameters<typeof eventBus.on>[1],
        );
      }
      extensionEventHandlers
        .get(extId)!
        .push({ event: event as AppEventType, handler });
    },

    off(event: string, handler: (payload: AppEvent) => void) {
      if (event.startsWith("extension:")) {
        eventBus.offExtension(event, handler as (e: ExtensionEvent) => void);
      } else {
        eventBus.off(
          event as AppEventType,
          handler as Parameters<typeof eventBus.off>[1],
        );
      }
      const handlers = extensionEventHandlers.get(extId);
      if (handlers) {
        const idx = handlers.findIndex(
          (h) => h.event === event && h.handler === handler,
        );
        if (idx >= 0) handlers.splice(idx, 1);
      }
    },

    emit(event: string, payload?: Record<string, unknown>) {
      if (!event.startsWith("extension:")) {
        throw new Error(
          `[extension:${extId}] Extensions can only emit "extension:" prefixed events, got "${event}"`,
        );
      }
      eventBus.emitExtension({ type: event, ...payload });
    },

    registerSecondarySidebarTab(tabId: string, component: unknown) {
      const declared = manifest.contributes?.secondarySidebarTabs?.find(
        (t) => t.id === tabId,
      );
      registerSidebarTab({
        id: `${extId}:${tabId}`,
        label: declared?.label ?? tabId,
        icon: declared?.icon,
        component,
        source: extId,
      });
    },

    registerSecondarySidebarAction(
      tabId: string,
      actionId: string,
      handler: () => void,
    ) {
      const declaredTab = manifest.contributes?.secondarySidebarTabs?.find(
        (t) => t.id === tabId,
      );
      const declaredAction = declaredTab?.actions?.find(
        (a) => a.id === actionId,
      );
      registerSidebarAction({
        tabId: `${extId}:${tabId}`,
        actionId,
        title: declaredAction?.title,
        handler,
        source: extId,
      });
    },

    registerPrimarySidebarSection(
      sectionId: string,
      component: unknown,
      options?: {
        collapsible?: boolean;
        showLabel?: boolean;
        label?: string;
        props?: Record<string, unknown>;
      },
    ) {
      const declared = manifest.contributes?.primarySidebarSections?.find(
        (s) => s.id === sectionId,
      );
      registerSidebarSection({
        id: `${extId}:${sectionId}`,
        label: options?.label ?? declared?.label ?? sectionId,
        component,
        source: extId,
        collapsible: options?.collapsible,
        showLabel: options?.showLabel,
        props: options?.props,
      });
    },

    registerSurfaceType(surfaceId: string, component: unknown) {
      const declared = manifest.contributes?.surfaces?.find(
        (s) => s.id === surfaceId,
      );
      registryRegisterSurfaceType({
        id: `${extId}:${surfaceId}`,
        label: declared?.label ?? surfaceId,
        component,
        source: extId,
      });
    },

    registerCommand(commandId: string, handler: () => void | Promise<void>) {
      const namespacedId = `${extId}:${commandId}`;
      // Look up title from manifest contributions
      const declared = manifest.contributes?.commands?.find(
        (c) => c.id === commandId,
      );
      registryRegisterCommand({
        id: namespacedId,
        title: declared?.title ?? commandId,
        action: handler,
        source: extId,
      });
    },

    registerContextMenuItem(
      itemId: string,
      handler: (filePath: string) => void,
    ) {
      const declared = manifest.contributes?.contextMenuItems?.find(
        (c) => c.id === itemId,
      );
      if (!declared) {
        throw new Error(
          `[extension:${extId}] Context menu item "${itemId}" is not declared in the manifest. ` +
            `Add it to contributes.contextMenuItems before registering.`,
        );
      }
      const namespacedId = `${extId}:${itemId}`;
      registryRegisterContextMenuItem({
        id: namespacedId,
        label: declared.label ?? itemId,
        when: declared.when ?? "*",
        handler,
        source: extId,
      });
    },

    registerWorkspaceAction(
      actionId: string,
      options: {
        label: string;
        icon: string;
        shortcut?: string;
        handler: (
          ctx: import("./workspace-action-registry").WorkspaceActionContext,
        ) => void | Promise<void>;
        when?: (
          ctx: import("./workspace-action-registry").WorkspaceActionContext,
        ) => boolean;
      },
    ) {
      const namespacedId = `${extId}:${actionId}`;
      registryRegisterWorkspaceAction({
        id: namespacedId,
        label: options.label,
        icon: options.icon,
        shortcut: options.shortcut,
        source: extId,
        handler: options.handler,
        when: options.when,
      });
    },

    getWorkspaceActions() {
      return registryGetWorkspaceActions().map((a) => ({
        id: a.id,
        label: a.label,
        icon: a.icon,
        shortcut: a.shortcut,
        handler: a.handler,
        when: a.when,
      }));
    },

    async pickDirectory(title?: string): Promise<string | null> {
      const result = await dialogOpen({
        directory: true,
        title: title ?? "Select Directory",
      });
      if (typeof result === "string") return result;
      return null;
    },

    state: {
      get<T>(key: string): T | undefined {
        return extensionStateMap.get(extId)?.get(key) as T | undefined;
      },
      set<T>(key: string, value: T): void {
        const stateMap = extensionStateMap.get(extId);
        if (stateMap) {
          stateMap.set(key, value);
          // Debounce disk persistence to prevent concurrent write races
          const existing = stateDebounceTimers.get(extId);
          if (existing) clearTimeout(existing);
          stateDebounceTimers.set(
            extId,
            setTimeout(() => {
              stateDebounceTimers.delete(extId);
              const obj = Object.fromEntries(stateMap.entries());
              saveExtensionState(extId, obj).catch((err) => {
                console.warn(
                  `[extension:${extId}] Failed to persist state:`,
                  err,
                );
              });
            }, STATE_DEBOUNCE_MS),
          );
        }
      },
    },

    // Extension settings (from config, declared in manifest)
    getSetting<T = unknown>(key: string): T | undefined {
      const cfg = getConfig();
      const extSettings = cfg.extensions?.[extId]?.settings;
      if (extSettings && key in extSettings) {
        return extSettings[key] as T;
      }
      // Fall back to manifest default
      const field = manifest.contributes?.settings?.fields?.[key];
      return field?.default as T | undefined;
    },
    getSettings(): Record<string, unknown> {
      const cfg = getConfig();
      const extSettings = cfg.extensions?.[extId]?.settings || {};
      // Merge defaults from manifest for any missing keys
      const fields = manifest.contributes?.settings?.fields || {};
      const result: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(fields)) {
        result[key] = key in extSettings ? extSettings[key] : field.default;
      }
      return result;
    },

    // Tauri command invocation — allowlisted commands only
    invoke<T = unknown>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> {
      if (!allowedCommands.has(command)) {
        return Promise.reject(
          new Error(
            `[extension:${extId}] Command "${command}" is not allowed. ` +
              `Allowed commands: ${[...allowedCommands].join(", ")}`,
          ),
        );
      }
      // Block extension access to app config directory for path-bearing commands
      if (PATH_COMMANDS.has(command) && args) {
        const pathArg = (args.path ?? args.dirPath ?? "") as string;
        if (pathArg && isBlockedAppPath(pathArg)) {
          return Promise.reject(
            new Error(
              `[extension:${extId}] Access denied: extensions cannot access the app config directory`,
            ),
          );
        }
      }
      // Track watch_file/unwatch_file for cleanup on deactivation.
      // For watch_file, chain .then() so the ID is tracked before the
      // caller's .then() runs — prevents stale IDs on rapid unwatch.
      if (command === "watch_file") {
        return tauriInvoke<T>(command, args).then((watchId) => {
          extensionWatchIds.get(extId)?.add(watchId as number);
          return watchId;
        });
      }
      if (command === "unwatch_file" && args?.watchId != null) {
        extensionWatchIds.get(extId)?.delete(args.watchId as number);
      }
      return tauriInvoke<T>(command, args);
    },

    // Actions
    openFile(path: string) {
      pendingAction.set({ type: "open-preview", payload: path });
    },
    getActiveCwd() {
      return getActiveCwd();
    },
    showInputPrompt(label: string, defaultValue?: string) {
      return coreShowInputPrompt(label, defaultValue);
    },
    toggleSecondarySidebar() {
      secondarySidebarVisible.update((v) => !v);
    },
    createWorkspace(
      name: string,
      cwd: string,
      options?: {
        env?: Record<string, string>;
        metadata?: Record<string, unknown>;
      },
    ) {
      pendingAction.set({ type: "create-workspace", name, cwd, options });
    },
    openInEditor(filePath: string) {
      pendingAction.set({ type: "open-in-editor", filePath });
    },
    openSurface(
      surfaceTypeId: string,
      title: string,
      props?: Record<string, unknown>,
    ) {
      pendingAction.set({ type: "open-surface", surfaceTypeId, title, props });
    },

    showFileContextMenu(x: number, y: number, filePath: string) {
      showContextMenuFor(x, y, filePath, getContextMenuItemsForFile);
    },

    showDirContextMenu(x: number, y: number, dirPath: string) {
      showContextMenuFor(x, y, dirPath, getContextMenuItemsForDir);
    },

    readClipboard() {
      return clipboardRead();
    },
    writeClipboard(text: string) {
      return clipboardWrite(text);
    },

    onFileChanged(
      watchId: number,
      handler: (event: {
        watchId: number;
        path: string;
        content: string;
      }) => void,
    ): () => void {
      // Use the single global file-changed listener instead of creating
      // one Tauri listener per call — fans out by watchId.
      ensureGlobalFileChangedListener();
      if (!fileChangedHandlers.has(watchId)) {
        fileChangedHandlers.set(watchId, new Set());
      }
      fileChangedHandlers.get(watchId)!.add(handler);
      const cleanup = () => {
        const handlers = fileChangedHandlers.get(watchId);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            fileChangedHandlers.delete(watchId);
          }
        }
      };
      extensionTauriListeners.get(extId)?.push(cleanup);
      return cleanup;
    },

    // Project stores to their public Ref types at runtime — the TypeScript
    // types (WorkspaceRef, PaneRef, SurfaceRef) are type-only; without this
    // projection the full internal objects (ptyId, cwd, DOM refs) leak.
    workspaces: {
      subscribe(fn: (value: unknown) => void) {
        return workspaces.subscribe((ws) =>
          fn(ws.map((w) => ({ id: w.id, name: w.name }))),
        );
      },
    } as ExtensionAPI["workspaces"],
    activeWorkspace: {
      subscribe(fn: (value: unknown) => void) {
        return activeWorkspace.subscribe((w) =>
          fn(w ? { id: w.id, name: w.name } : null),
        );
      },
    } as ExtensionAPI["activeWorkspace"],
    activePane: {
      subscribe(fn: (value: unknown) => void) {
        return activePane.subscribe((p) =>
          fn(
            p
              ? {
                  id: p.id,
                  surfaces: p.surfaces.map((s) => ({
                    id: s.id,
                    kind: s.kind,
                    title: s.title,
                    hasUnread: s.hasUnread,
                  })),
                  activeSurfaceId: p.activeSurfaceId,
                }
              : null,
          ),
        );
      },
    } as ExtensionAPI["activePane"],
    activeSurface: {
      subscribe(fn: (value: unknown) => void) {
        return activeSurface.subscribe((s) =>
          fn(
            s
              ? {
                  id: s.id,
                  kind: s.kind,
                  title: s.title,
                  hasUnread: s.hasUnread,
                }
              : null,
          ),
        );
      },
    } as ExtensionAPI["activeSurface"],
    theme: readOnly(theme) as unknown as ExtensionAPI["theme"],
    settings: settingsStore,

    getSidebarTabs() {
      return get(sidebarTabStore).map((t) => ({
        id: t.id,
        label: t.label,
        component: t.component,
      }));
    },
    getSidebarSections() {
      return get(sidebarSectionStore).map((s) => ({
        id: s.id,
        label: s.label,
        component: s.component,
      }));
    },
  };

  return {
    api,
    getActivateCallback: () => _onActivate,
    getDeactivateCallback: () => _onDeactivate,
  };
}

// --- Extension registration and lifecycle ---

export function registerExtension(
  manifest: ExtensionManifest,
  registerFn?: ExtensionRegisterFn,
): void {
  const current = get(_extensions);

  if (current.some((e) => e.manifest.id === manifest.id)) {
    throw new Error(`Extension "${manifest.id}" is already registered`);
  }

  const { api, getActivateCallback, getDeactivateCallback } =
    createExtensionAPI(manifest);

  extensionApis.set(manifest.id, api);

  // Call the register function if provided (sets up onActivate/onDeactivate)
  if (registerFn) {
    try {
      registerFn(api);
    } catch (err) {
      // Clean up the API entry we just set — registration failed
      extensionApis.delete(manifest.id);
      extensionStateMap.delete(manifest.id);
      extensionEventHandlers.delete(manifest.id);
      extensionTauriListeners.delete(manifest.id);
      extensionWatchIds.delete(manifest.id);
      throw err;
    }
  }

  const extension: LoadedExtension = {
    manifest,
    enabled: false,
    api,
    activateCallback: getActivateCallback(),
    deactivateCallback: getDeactivateCallback(),
  };

  _extensions.update((list) => [...list, extension]);
}

export async function activateExtension(id: string): Promise<void> {
  const current = get(_extensions);

  const ext = current.find((e) => e.manifest.id === id);
  if (!ext) {
    throw new Error(`Extension "${id}" not found`);
  }
  if (ext.enabled) return; // Already active, no-op

  // Load persisted state from disk into the in-memory map
  try {
    const persisted = await loadExtensionState(id);
    const stateMap = extensionStateMap.get(id);
    if (stateMap) {
      for (const [key, value] of Object.entries(persisted)) {
        stateMap.set(key, value);
      }
    }
  } catch {
    // State loading is best-effort — continue activation
  }

  if (ext.activateCallback) {
    try {
      await ext.activateCallback();
    } catch (err) {
      // Rollback any partial registry mutations made during activation
      unregisterBySource(id);
      unregisterSidebarTabsBySource(id);
      unregisterSidebarSectionsBySource(id);
      unregisterSurfaceTypesBySource(id);
      unregisterContextMenuItemsBySource(id);
      unregisterWorkspaceActionsBySource(id);
      // Clean up event subscriptions registered during activation
      const handlers = extensionEventHandlers.get(id);
      if (handlers) {
        for (const { event, handler } of handlers) {
          eventBus.off(event, handler);
        }
        handlers.length = 0;
      }
      // Clean up Tauri event listeners registered during activation
      const tauriListeners = extensionTauriListeners.get(id);
      if (tauriListeners) {
        for (const cleanup of tauriListeners) {
          cleanup();
        }
        tauriListeners.length = 0;
      }
      // Stop Rust-side file watchers registered during activation
      const watchIds = extensionWatchIds.get(id);
      if (watchIds && watchIds.size > 0) {
        for (const watchId of watchIds) {
          tauriInvoke("unwatch_file", { watchId }).catch(() => {});
        }
        watchIds.clear();
      }
      throw err;
    }
  }

  _extensions.update((list) =>
    list.map((e) => (e.manifest.id === id ? { ...e, enabled: true } : e)),
  );
}

export function deactivateExtension(id: string): void {
  const current = get(_extensions);

  const ext = current.find((e) => e.manifest.id === id);
  if (!ext || !ext.enabled) return; // Not active, no-op

  // Call deactivate callback — guarded so cleanup always runs
  if (ext.deactivateCallback) {
    try {
      ext.deactivateCallback();
    } catch (err) {
      console.error(`[extension:${id}] Error in deactivate callback:`, err);
    }
  }

  // Clean up event subscriptions
  const handlers = extensionEventHandlers.get(id);
  if (handlers) {
    for (const { event, handler } of handlers) {
      eventBus.off(event, handler);
    }
    handlers.length = 0;
  }

  // Clean up Tauri event listeners
  const tauriListeners = extensionTauriListeners.get(id);
  if (tauriListeners) {
    for (const cleanup of tauriListeners) {
      cleanup();
    }
    tauriListeners.length = 0;
  }

  // Stop Rust-side file watchers registered by this extension
  const watchIds = extensionWatchIds.get(id);
  if (watchIds && watchIds.size > 0) {
    for (const watchId of watchIds) {
      tauriInvoke("unwatch_file", { watchId }).catch((err: unknown) => {
        console.warn(
          `[extension:${id}] Failed to unwatch file ${watchId}:`,
          err,
        );
      });
    }
    watchIds.clear();
  }

  // Close any active surfaces using this extension's surface types
  // (must happen before unregistering the types)
  const extSurfaceTypeIds = get(surfaceTypeStore)
    .filter((t) => t.source === id)
    .map((t) => t.id);
  if (extSurfaceTypeIds.length > 0) {
    closeExtensionSurfaces(extSurfaceTypeIds);
  }

  // Clean up all registered contributions
  unregisterBySource(id);
  unregisterSidebarTabsBySource(id);
  unregisterSidebarSectionsBySource(id);
  unregisterSurfaceTypesBySource(id);
  unregisterContextMenuItemsBySource(id);
  unregisterWorkspaceActionsBySource(id);

  _extensions.update((list) =>
    list.map((e) => (e.manifest.id === id ? { ...e, enabled: false } : e)),
  );
}

export async function unloadExtension(id: string): Promise<void> {
  // Deactivate first if active
  deactivateExtension(id);

  // Flush any pending debounced state write before clearing
  const timer = stateDebounceTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    stateDebounceTimers.delete(id);
    const stateMap = extensionStateMap.get(id);
    if (stateMap && stateMap.size > 0) {
      const obj = Object.fromEntries(stateMap.entries());
      await saveExtensionState(id, obj).catch((err) => {
        console.warn(`[extension:${id}] Failed to flush state on unload:`, err);
      });
    }
  }

  // Remove from store
  _extensions.update((list) => list.filter((e) => e.manifest.id !== id));

  // Clean up state maps
  extensionStateMap.delete(id);
  extensionEventHandlers.delete(id);
  extensionTauriListeners.delete(id);
  extensionWatchIds.delete(id);
  extensionApis.delete(id);
}

/** Reset all extensions — for testing only. */
export async function resetExtensions(): Promise<void> {
  const current = get(_extensions);

  for (const ext of current) {
    deactivateExtension(ext.manifest.id);
  }

  _extensions.set([]);
  extensionStateMap.clear();
  extensionEventHandlers.clear();
  extensionTauriListeners.clear();
  extensionWatchIds.clear();
  extensionApis.clear();
  for (const timer of stateDebounceTimers.values()) clearTimeout(timer);
  stateDebounceTimers.clear();

  // Tear down the global file-changed Tauri listener.
  // Await the setup promise to ensure the unlisten function is available
  // before clearing — prevents orphaned listeners when reset races setup.
  if (globalFileChangedSetup) {
    await globalFileChangedSetup.catch(() => {});
  }
  _globalFileChangedUnlisten?.();
  _globalFileChangedUnlisten = undefined;
  globalFileChangedSetup = undefined;
  fileChangedHandlers.clear();

  // Reset the cached blocked app dir
  _blockedAppDir = undefined;
}
