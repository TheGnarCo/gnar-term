/**
 * Extension API Construction — builds sandboxed ExtensionAPI instances.
 *
 * Extracted from extension-loader.ts for maintainability. This module contains
 * all the helper constructors that assemble the per-extension API object:
 * event subscriptions, Tauri command bridging, state/settings, UI registration,
 * store projections, and the top-level createExtensionAPI() factory.
 */
import { get } from "svelte/store";
import { eventBus, type AppEventType } from "./event-bus";
import {
  setSidebarTabBadge,
  clearSidebarTabBadge,
  activateSidebarTab as activateSidebarTabFn,
} from "./sidebar-tab-registry";
import { surfaceTypeStore } from "./surface-type-registry";
import {
  getContextMenuItemsForFile,
  getContextMenuItemsForDir,
} from "./context-menu-item-registry";
import {
  claimWorkspace as registryClaimWorkspace,
  unclaimWorkspace as registryUnclaimWorkspace,
} from "./claimed-workspace-registry";
import { dashboardTabStore } from "./dashboard-tab-registry";
import {
  childRowContributorStore,
  getChildRowsFor,
} from "./child-row-contributor-registry";
import { rootRowRendererStore } from "./root-row-renderer-registry";
import {
  EXTENSION_ALLOWED_COMMANDS,
  PTY_COMMANDS,
  SHELL_COMMANDS,
  FILESYSTEM_COMMANDS,
  OBSERVE_PERMISSION,
  REGISTRY_CLEANUP_FNS,
  getBlockedAppDir,
} from "./extension-constants";
import {
  addOutputObserver,
  removeOutputObserver,
} from "./surface-output-observer";
import { reportExtensionError } from "./extension-loader";
import {
  closeExtensionSurfaces,
  markSurfaceUnreadById,
  focusSurfaceById,
  openFileAsPreviewSplit,
} from "./surface-service";
import {
  secondarySidebarVisible,
  pendingAction,
  showInputPrompt as coreShowInputPrompt,
  showFormPrompt as coreShowFormPrompt,
  showConfirmPrompt as coreShowConfirmPrompt,
} from "../stores/ui";
import { setAgentStatus, clearAgentStatus } from "../stores/agent-status";
import {
  invoke as tauriInvoke,
  convertFileSrc as tauriConvertFileSrc,
} from "@tauri-apps/api/core";
import {
  readText as clipboardRead,
  writeText as clipboardWrite,
} from "@tauri-apps/plugin-clipboard-manager";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted as notifPermissionGranted,
  requestPermission as notifRequestPermission,
  sendNotification as notifSend,
} from "@tauri-apps/plugin-notification";
import WorkspaceListView from "../components/WorkspaceListView.svelte";
import ContainerRow from "../components/ContainerRow.svelte";
import PathStatusLine from "../components/PathStatusLine.svelte";
import SplitButton from "../components/SplitButton.svelte";
import ColorPicker from "../components/ColorPicker.svelte";
import DragGrip from "../components/DragGrip.svelte";
import DropGhost from "../components/DropGhost.svelte";
import {
  createDragReorder,
  type DragReorderConfig,
  type DragReorderHandle,
} from "../actions/drag-reorder";
import { reorderContext, anyReorderActive, contextMenu } from "../stores/ui";
import { getActiveCwd } from "./service-helpers";
import { workspaces } from "../stores/workspace";
import { getAllSurfaces, isTerminalSurface } from "../types";
import type { ExtensionManifest, ExtensionAPI } from "../extension-types";
import type { AppEvent } from "./event-bus";
import {
  createEventAPI,
  ensureGlobalFileChangedListener,
  fileChangedHandlers,
  showContextMenuFor,
  teardownFileChangedListener,
} from "./extension-api-events";
import { createCommandAPI } from "./extension-api-commands";
import { createStateAPI } from "./extension-api-state";
import { createUIRegistrationAPI } from "./extension-api-ui";
import { createStoreProjections } from "./extension-api-stores";
import { createStatusAPI } from "./extension-api-status";

// Re-export for consumers that import teardownFileChangedListener from here
export { teardownFileChangedListener };

// ---- Shared mutable state (owned by extension-loader, passed in via params) ----

/** Refs to shared extension state maps, injected by extension-loader.ts. */
export interface ExtensionMaps {
  stateMap: Map<string, Map<string, unknown>>;
  eventHandlers: Map<
    string,
    Array<{ event: AppEventType; handler: (payload: AppEvent) => void }>
  >;
  tauriListeners: Map<string, Array<() => void>>;
  watchIds: Map<string, Set<number>>;
  stateDebounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  setExtensionState: <T>(extId: string, key: string, value: T) => void;
}

// --- ExtensionAPI construction ---

export function createExtensionAPI(
  manifest: ExtensionManifest,
  maps: ExtensionMaps,
): {
  api: ExtensionAPI;
  getActivateCallback: () => (() => void | Promise<void>) | undefined;
  getDeactivateCallback: () => (() => void) | undefined;
} {
  const extId = manifest.id;

  // Eagerly resolve the blocked app dir so the sync check works
  // Pre-warm the path cache; failure just means sync checks fall back
  getBlockedAppDir().catch(() => {});

  const declaredEvents = manifest.contributes?.events ?? [];
  const eventAllowSet = new Set(declaredEvents);

  // Build per-extension command allowlist — expand based on declared permissions
  const permissions = new Set(manifest.permissions ?? []);
  const allowedCommands = new Set(EXTENSION_ALLOWED_COMMANDS);
  if (permissions.has("pty")) {
    for (const cmd of PTY_COMMANDS) allowedCommands.add(cmd);
    console.warn(
      `[extension:${extId}] Elevated permissions: PTY access granted`,
    );
  }
  if (permissions.has("shell")) {
    for (const cmd of SHELL_COMMANDS) allowedCommands.add(cmd);
    console.warn(
      `[extension:${extId}] Elevated permissions: shell execution granted`,
    );
  }
  if (permissions.has("filesystem")) {
    for (const cmd of FILESYSTEM_COMMANDS) allowedCommands.add(cmd);
    console.warn(
      `[extension:${extId}] Elevated permissions: filesystem access granted`,
    );
  }
  if (permissions.has(OBSERVE_PERMISSION)) {
    console.warn(
      `[extension:${extId}] Elevated permissions: terminal output observation granted`,
    );
  }

  // Initialize state and event tracking for this extension
  if (!maps.stateMap.has(extId)) {
    maps.stateMap.set(extId, new Map());
  }
  if (!maps.eventHandlers.has(extId)) {
    maps.eventHandlers.set(extId, []);
  }
  if (!maps.tauriListeners.has(extId)) {
    maps.tauriListeners.set(extId, []);
  }
  if (!maps.watchIds.has(extId)) {
    maps.watchIds.set(extId, new Set());
  }

  // Lifecycle callbacks — captured by registerExtension
  let _onActivate: (() => void | Promise<void>) | undefined;
  let _onDeactivate: (() => void) | undefined;

  const api: ExtensionAPI = {
    onActivate(callback) {
      _onActivate = callback;
    },
    onDeactivate(callback) {
      _onDeactivate = callback;
    },

    ...createEventAPI(extId, eventAllowSet, declaredEvents, maps),
    ...createUIRegistrationAPI(extId, manifest),
    ...createCommandAPI(extId, allowedCommands, maps),
    ...createStateAPI(extId, manifest, maps),
    ...createStoreProjections(extId),
    ...createStatusAPI(extId),

    // --- Remaining short methods (inline) ---

    async pickDirectory(title?: string): Promise<string | null> {
      const result = await dialogOpen({
        directory: true,
        title: title ?? "Select Directory",
      });
      if (typeof result === "string") return result;
      return null;
    },

    claimWorkspace(workspaceId: string) {
      registryClaimWorkspace(workspaceId, extId);
    },

    unclaimWorkspace(workspaceId: string) {
      registryUnclaimWorkspace(workspaceId);
    },

    openFile(path: string) {
      const items = getContextMenuItemsForFile(path);
      void items[0]?.handler(path);
    },
    getActiveCwd() {
      return getActiveCwd();
    },
    showInputPrompt(label: string, defaultValue?: string) {
      return coreShowInputPrompt(label, defaultValue);
    },
    showConfirm(
      message: string,
      options?: {
        title?: string;
        confirmLabel?: string;
        cancelLabel?: string;
      },
    ): Promise<boolean> {
      // Uses the themed ConfirmPrompt overlay (store-driven). Tauri v2
      // blocks window.confirm() behind the dialog plugin capability,
      // so we render our own modal instead.
      return coreShowConfirmPrompt(message, options);
    },
    showFormPrompt(
      title: string,
      fields: Array<
        | {
            key: string;
            label: string;
            defaultValue?: string;
            placeholder?: string;
            type?: "text";
          }
        | {
            key: string;
            label: string;
            defaultValue?: string;
            type: "select";
            options: Array<{ label: string; value: string }>;
          }
        | {
            key: string;
            label: string;
            defaultValue?: string;
            type: "info";
          }
        | {
            key: string;
            label: string;
            defaultValue?: string;
            type: "color";
          }
        | {
            key: string;
            label: string;
            defaultValue?: string;
            placeholder?: string;
            type: "directory";
            required?: boolean;
            pickerTitle?: string;
            readonly?: boolean;
          }
      >,
      options?: { submitLabel?: string },
    ) {
      // Preserve the 2-arg call shape for callers that don't need options
      // so existing spies in tests continue to match.
      return options
        ? coreShowFormPrompt(title, fields, options)
        : coreShowFormPrompt(title, fields);
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
    openPreviewSplit(filePath: string) {
      openFileAsPreviewSplit(filePath);
    },
    openSurface(
      surfaceTypeId: string,
      title: string,
      props?: Record<string, unknown>,
    ) {
      const namespacedId = surfaceTypeId.includes(":")
        ? surfaceTypeId
        : `${extId}:${surfaceTypeId}`;
      pendingAction.set({
        type: "open-surface",
        surfaceTypeId: namespacedId,
        title,
        props,
      });
    },
    switchWorkspace(workspaceId: string) {
      pendingAction.set({ type: "switch-workspace", workspaceId });
    },
    closeWorkspace(workspaceId: string) {
      pendingAction.set({ type: "close-workspace", workspaceId });
    },

    markSurfaceUnread(surfaceId: string) {
      markSurfaceUnreadById(surfaceId);
    },
    focusSurface(surfaceId: string) {
      focusSurfaceById(surfaceId);
    },
    getWorkspaceIdForSurface(surfaceId: string): string | null {
      for (const ws of get(workspaces)) {
        for (const surf of getAllSurfaces(ws)) {
          if (surf.id === surfaceId) return ws.id;
        }
      }
      return null;
    },
    reportError(message: string): void {
      reportExtensionError(extId, message);
    },
    getAllTerminalSurfaces() {
      const out: Array<{ id: string; workspaceId: string; title: string }> = [];
      for (const ws of get(workspaces)) {
        for (const surf of getAllSurfaces(ws)) {
          if (isTerminalSurface(surf)) {
            out.push({
              id: surf.id,
              workspaceId: ws.id,
              title: surf.title ?? "",
            });
          }
        }
      }
      return out;
    },

    badgeSidebarTab(tabId: string, hasBadge: boolean) {
      const namespacedId = `${extId}:${tabId}`;
      if (hasBadge) {
        setSidebarTabBadge(namespacedId, true);
      } else {
        clearSidebarTabBadge(namespacedId);
      }
    },
    activateSidebarTab(tabId: string) {
      const namespacedId = `${extId}:${tabId}`;
      activateSidebarTabFn(namespacedId);
    },
    setWorkspaceIndicator(workspaceId: string, status: string | null) {
      if (status === null) {
        clearAgentStatus(workspaceId);
      } else {
        setAgentStatus(workspaceId, status);
      }
    },

    showFileContextMenu(x: number, y: number, filePath: string) {
      showContextMenuFor(x, y, filePath, getContextMenuItemsForFile);
    },

    showDirContextMenu(x: number, y: number, dirPath: string) {
      showContextMenuFor(x, y, dirPath, getContextMenuItemsForDir);
    },

    showContextMenu(
      x: number,
      y: number,
      items: Array<{
        label: string;
        action: () => void;
        shortcut?: string;
        separator?: boolean;
        disabled?: boolean;
        danger?: boolean;
      }>,
    ) {
      if (items.length === 0) return;
      contextMenu.set({ x, y, items });
    },

    readClipboard() {
      return clipboardRead();
    },
    writeClipboard(text: string) {
      return clipboardWrite(text);
    },

    async sendNotification(title: string, body?: string): Promise<void> {
      let permitted = await notifPermissionGranted();
      if (!permitted) {
        const result = await notifRequestPermission();
        permitted = result === "granted";
      }
      if (!permitted) return;
      notifSend({ title, body });
    },

    onSurfaceOutput(
      surfaceId: string,
      callback: (data: string) => void,
    ): () => void {
      if (!permissions.has(OBSERVE_PERMISSION)) {
        console.warn(
          `[extension:${extId}] onSurfaceOutput requires "observe" permission`,
        );
        return () => {};
      }

      // Resolve surfaceId → ptyId by scanning all workspaces.
      // The PTY may not be connected yet (ptyId = -1) when surface:created
      // fires, so we subscribe to the workspaces store and wait for it.
      let observedPtyId: number | null = null;
      let cleaned = false;

      function resolvePty(): number | null {
        const allWs = get(workspaces);
        for (const ws of allWs) {
          for (const surf of getAllSurfaces(ws)) {
            if (
              surf.id === surfaceId &&
              isTerminalSurface(surf) &&
              surf.ptyId >= 0
            ) {
              return surf.ptyId;
            }
          }
        }
        return null;
      }

      function attach(ptyId: number) {
        observedPtyId = ptyId;
        addOutputObserver(ptyId, callback);
      }

      // Try immediate resolution
      const immediate = resolvePty();
      if (immediate !== null) {
        attach(immediate);
      }

      // If not resolved yet, watch for PTY connection
      const unsub =
        immediate === null
          ? workspaces.subscribe(() => {
              if (cleaned || observedPtyId !== null) return;
              const ptyId = resolvePty();
              if (ptyId !== null) {
                attach(ptyId);
                unsub?.();
              }
            })
          : null;

      const cleanup = () => {
        cleaned = true;
        unsub?.();
        if (observedPtyId !== null) {
          removeOutputObserver(observedPtyId, callback);
        }
      };
      maps.tauriListeners.get(extId)?.push(cleanup);
      return cleanup;
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
      maps.tauriListeners.get(extId)?.push(cleanup);
      return cleanup;
    },

    getDashboardTabs() {
      return get(dashboardTabStore).map((t) => ({
        id: t.id,
        label: t.label,
        component: t.component,
        props: t.props,
      }));
    },
    getChildRowsFor(parentType: string, parentId: string) {
      return getChildRowsFor(parentType, parentId);
    },
    childRowContributors: childRowContributorStore,
    getRootRowRenderer(kind: string) {
      const r = get(rootRowRendererStore).find((x) => x.id === kind);
      return r ? { component: r.component } : undefined;
    },
    convertFileSrc(path: string): string {
      return tauriConvertFileSrc(path);
    },
    getComponents() {
      return {
        WorkspaceListView,
        SplitButton,
        ColorPicker,
        DragGrip,
        DropGhost,
        ContainerRow,
        PathStatusLine,
      };
    },
    createDragReorder(
      config: DragReorderConfig & {
        scope?: "inner" | "block";
        buildReorderContext?: (
          state: ReturnType<DragReorderHandle["getState"]>,
        ) => import("../../extensions/api").ReorderContext | null;
      },
    ): DragReorderHandle {
      const { scope, buildReorderContext, onStateChange, canStart, ...rest } =
        config;
      let handle: DragReorderHandle;
      if (scope === "inner") {
        // Inner (row-level) scope gates canStart on anyReorderActive and
        // auto-publishes to the global reorderContext store when a
        // buildReorderContext callback is supplied.
        handle = createDragReorder({
          ...rest,
          canStart: () => {
            if (get(anyReorderActive)) return false;
            return canStart ? canStart() : true;
          },
          onStateChange: () => {
            if (buildReorderContext) {
              reorderContext.set(buildReorderContext(handle.getState()));
            }
            onStateChange?.();
          },
        });
      } else {
        handle = createDragReorder({ ...rest, canStart, onStateChange });
      }
      return handle;
    },
  };

  return {
    api,
    getActivateCallback: () => _onActivate,
    getDeactivateCallback: () => _onDeactivate,
  };
}

/**
 * Clean up all resources registered by an extension — registries, event
 * handlers, Tauri listeners, and file watchers. Used by both
 * activateExtension (rollback on failure) and deactivateExtension.
 */
export function cleanupExtensionResources(
  id: string,
  maps: ExtensionMaps,
): void {
  // Clean up event subscriptions
  const handlers = maps.eventHandlers.get(id);
  if (handlers) {
    for (const { event, handler } of handlers) {
      eventBus.off(event, handler);
    }
    handlers.length = 0;
  }

  // Clean up Tauri event listeners
  const tauriListeners = maps.tauriListeners.get(id);
  if (tauriListeners) {
    for (const cleanup of tauriListeners) {
      cleanup();
    }
    tauriListeners.length = 0;
  }

  // Stop Rust-side file watchers
  const watchIds = maps.watchIds.get(id);
  if (watchIds && watchIds.size > 0) {
    for (const watchId of watchIds) {
      // Best-effort cleanup — watcher may already be gone
      tauriInvoke("unwatch_file", { watchId }).catch(() => {});
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
  for (const cleanup of REGISTRY_CLEANUP_FNS) {
    cleanup(id);
  }
}
