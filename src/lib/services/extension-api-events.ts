import {
  eventBus,
  type AppEventType,
  type AppEvent,
  type ExtensionEvent,
} from "./event-bus";
import { listen } from "@tauri-apps/api/event";
import { contextMenu } from "../stores/ui";
import type { ExtensionAPI } from "../extension-types";
import type { ExtensionMaps } from "./extension-api";

type FileChangedHandler = (event: {
  watchId: number;
  path: string;
  content: string;
}) => void;
export const fileChangedHandlers = new Map<number, Set<FileChangedHandler>>();
let _globalFileChangedUnlisten: (() => void) | undefined;
let globalFileChangedSetup: Promise<void> | undefined;

export function ensureGlobalFileChangedListener(): void {
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

/** Tear down the global file-changed listener. Called by resetExtensions(). */
export async function teardownFileChangedListener(): Promise<void> {
  if (globalFileChangedSetup) {
    // Swallow setup errors — listener may never have initialized
    await globalFileChangedSetup.catch(() => {});
  }
  _globalFileChangedUnlisten?.();
  _globalFileChangedUnlisten = undefined;
  globalFileChangedSetup = undefined;
  fileChangedHandlers.clear();
}

export function showContextMenuFor(
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

/** Event subscription, unsubscription, and emission with allowlist enforcement. */
export function createEventAPI(
  extId: string,
  eventAllowSet: Set<string>,
  declaredEvents: string[],
  maps: ExtensionMaps,
): Pick<ExtensionAPI, "on" | "off" | "emit"> {
  return {
    on(event: string, handler: (payload: AppEvent) => void) {
      if (!eventAllowSet.has(event)) {
        throw new Error(
          `[extension:${extId}] Event "${event}" not declared in manifest. ` +
            `Declared events: ${declaredEvents.join(", ") || "(none)"}`,
        );
      }
      if (event.startsWith("extension:")) {
        eventBus.on(event, handler as (e: ExtensionEvent) => void);
      } else {
        eventBus.on(
          event as AppEventType,
          handler as Parameters<typeof eventBus.on>[1],
        );
      }
      maps.eventHandlers
        .get(extId)!
        .push({ event: event as AppEventType, handler });
    },

    off(event: string, handler: (payload: AppEvent) => void) {
      if (event.startsWith("extension:")) {
        eventBus.off(event, handler as (e: ExtensionEvent) => void);
      } else {
        eventBus.off(
          event as AppEventType,
          handler as Parameters<typeof eventBus.off>[1],
        );
      }
      const handlers = maps.eventHandlers.get(extId);
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
      // Same deny-by-default contract as on(): an extension can only emit
      // events that appear in its manifest's `contributes.events` array.
      // Without this check, one extension could spoof another extension's
      // event name and confuse subscribers (ADR-002 documents these as
      // stable cross-extension contracts).
      if (!eventAllowSet.has(event)) {
        throw new Error(
          `[extension:${extId}] Event "${event}" not declared in manifest. ` +
            `Declared events: ${declaredEvents.join(", ") || "(none)"}`,
        );
      }
      eventBus.emit({ type: event, ...payload });
    },
  };
}
