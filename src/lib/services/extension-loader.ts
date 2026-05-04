/**
 * Extension Loader — extension lifecycle management.
 *
 * Core responsibilities:
 * - Manage the reactive store of loaded extensions
 * - Handle activate/deactivate/unload lifecycle with cleanup
 * - Expose extension state accessors for core overlays
 *
 * API construction is delegated to extension-api.ts for maintainability.
 */
import { writable, get, type Readable } from "svelte/store";
import type { AppEventType, AppEvent } from "./event-bus";
import {
  createExtensionAPI as _createExtensionAPI,
  cleanupExtensionResources as _cleanupExtensionResources,
  teardownFileChangedListener,
  type ExtensionMaps,
} from "./extension-api";
import { resetBlockedAppDir } from "./extension-constants";
export {
  validateManifest,
  isValidExtensionId,
  type ValidationResult,
} from "./extension-validator";
// Wrap createExtensionAPI with maps pre-bound so external callers
// (including tests) don't need to know about the internal maps.
export function createExtensionAPI(
  manifest: import("../extension-types").ExtensionManifest,
) {
  return _createExtensionAPI(manifest, getMaps());
}
import { loadExtensionState, saveExtensionState } from "./extension-state";
import type {
  ExtensionManifest,
  ExtensionAPI,
  ExtensionRegisterFn,
  LoadedExtension,
} from "../extension-types";

// --- Extension store ---

const _extensions = writable<LoadedExtension[]>([]);
export const extensionStore: Readable<LoadedExtension[]> = _extensions;

// Track extensions that failed to load/activate for user-visible reporting
const _extensionErrors = writable<{ id: string; error: string }[]>([]);
export const extensionErrorStore: Readable<{ id: string; error: string }[]> =
  _extensionErrors;

export function reportExtensionError(id: string, error: string): void {
  _extensionErrors.update((errors) => [...errors, { id, error }]);
}

// API lookup by extension ID — used by ExtensionWrapper to inject context
const extensionApis = new Map<string, ExtensionAPI>();

export function getExtensionApiById(
  extensionId: string,
): ExtensionAPI | undefined {
  return extensionApis.get(extensionId);
}

/**
 * Register an ExtensionAPI for a core subsystem that doesn't live in
 * the extension layer but needs to mount components through
 * `ExtensionWrapper` (e.g. Workspaces — Stage 5 moved the CRUD into
 * core, but row renderers still flow through the ExtensionWrapper path
 * to inherit the shared Svelte context).
 *
 * Unlike `registerExtension`, this does not add to the `_extensions`
 * store and does not wire an activation lifecycle; it only registers
 * the api object so `getExtensionApiById(id)` returns something usable.
 * Re-registering the same id is a no-op.
 */
export function registerCoreExtensionAPI(manifest: ExtensionManifest): void {
  if (extensionApis.has(manifest.id)) return;
  const { api } = _createExtensionAPI(manifest, getMaps());
  extensionApis.set(manifest.id, api);
}

// --- Shared mutable state maps (passed to extension-api.ts helpers) ---

const extensionStateMap = new Map<string, Map<string, unknown>>();
const extensionEventHandlers = new Map<
  string,
  Array<{ event: AppEventType; handler: (payload: AppEvent) => void }>
>();
const extensionTauriListeners = new Map<string, Array<() => void>>();
const extensionWatchIds = new Map<string, Set<number>>();
const stateDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const STATE_DEBOUNCE_MS = 300;

/** Debounced state setter — shared across all extensions. */
function setExtensionState<T>(extId: string, key: string, value: T): void {
  let stateMap = extensionStateMap.get(extId);
  if (!stateMap) {
    stateMap = new Map();
    extensionStateMap.set(extId, stateMap);
  }
  stateMap.set(key, value);
  // Trigger debounced save
  if (stateDebounceTimers.has(extId)) {
    clearTimeout(stateDebounceTimers.get(extId)!);
  }
  const mapRef = stateMap;
  stateDebounceTimers.set(
    extId,
    setTimeout(() => {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of mapRef) obj[k] = v;
      void saveExtensionState(extId, obj);
    }, STATE_DEBOUNCE_MS),
  );
}

/** The shared maps bundle passed to extension-api.ts constructors. */
function getMaps(): ExtensionMaps {
  return {
    stateMap: extensionStateMap,
    eventHandlers: extensionEventHandlers,
    tauriListeners: extensionTauriListeners,
    watchIds: extensionWatchIds,
    stateDebounceTimers,
    setExtensionState,
  };
}

// --- Public state accessors (used by core overlays) ---

/** Read-only accessor for extension state — used by core overlays (e.g., dashboard). */
export function getExtensionState<T>(
  extId: string,
  key: string,
): T | undefined {
  return extensionStateMap.get(extId)?.get(key) as T | undefined;
}

/** Write accessor for extension state — used by core overlays (e.g., dashboard settings). */
export { setExtensionState };

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
    _createExtensionAPI(manifest, getMaps());

  extensionApis.set(manifest.id, api);

  // Call the register function if provided (sets up onActivate/onDeactivate)
  if (registerFn) {
    try {
      const result = registerFn(api);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          console.error(
            `[extension-loader] Async registration failed for "${manifest.id}":`,
            err,
          );
          extensionApis.delete(manifest.id);
          extensionStateMap.delete(manifest.id);
          extensionEventHandlers.delete(manifest.id);
          extensionTauriListeners.delete(manifest.id);
          extensionWatchIds.delete(manifest.id);
        });
      }
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
  } catch (e) {
    // State loading is best-effort — continue activation
    console.warn(`[extension:${id}] Failed to load persisted state:`, e);
  }

  if (ext.activateCallback) {
    try {
      await ext.activateCallback();
    } catch (err) {
      _cleanupExtensionResources(id, getMaps());
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

  _cleanupExtensionResources(id, getMaps());

  _extensions.update((list) =>
    list.map((e) => (e.manifest.id === id ? { ...e, enabled: false } : e)),
  );
}

/**
 * Flush all pending debounced state writes to disk.
 * Call this on app close so state like project nestedWorkspaceIds doesn't
 * get lost within the 300ms debounce window.
 *
 * Writes run in parallel so one slow extension can't block the others,
 * and failures are surfaced via reportExtensionError so the user sees
 * a toast on next launch instead of a silent data loss.
 */
export async function flushAllExtensionState(): Promise<void> {
  const pendingIds = Array.from(stateDebounceTimers.keys());
  const writes: Promise<void>[] = [];

  for (const id of pendingIds) {
    const timer = stateDebounceTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      stateDebounceTimers.delete(id);
    }
    const stateMap = extensionStateMap.get(id);
    if (stateMap && stateMap.size > 0) {
      const obj = Object.fromEntries(stateMap.entries());
      writes.push(
        saveExtensionState(id, obj).catch((err: unknown) => {
          reportExtensionError(id, `Failed to flush state on close: ${err}`);
        }),
      );
    }
  }

  await Promise.all(writes);
}

export async function unloadExtension(id: string): Promise<void> {
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

  // Tear down the global file-changed Tauri listener
  await teardownFileChangedListener();

  // Reset the cached blocked app dir
  resetBlockedAppDir();

  // Clear error reporting store
  _extensionErrors.set([]);
}

export function ensureProviderAndThen(
  surfaceTypeId: string,
  open: () => void,
): Promise<void> {
  const colonIdx = surfaceTypeId.indexOf(":");
  const providerId = colonIdx > 0 ? surfaceTypeId.slice(0, colonIdx) : null;
  if (!providerId) {
    open();
    return Promise.resolve();
  }
  return activateExtension(providerId)
    .catch((err) => {
      console.warn(`[status-action] activate "${providerId}" failed:`, err);
    })
    .finally(open);
}
