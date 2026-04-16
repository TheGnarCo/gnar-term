import { configStore as configStoreReadable, getConfig } from "../config";
import type { Readable } from "svelte/store";
import type { ExtensionManifest, ExtensionAPI } from "../extension-types";
import type { ExtensionMaps } from "./extension-api";

/** Per-extension state get/set, scoped settings from config, and settings store. */
export function createStateAPI(
  extId: string,
  manifest: ExtensionManifest,
  maps: ExtensionMaps,
): Pick<ExtensionAPI, "state" | "getSetting" | "getSettings" | "settings"> {
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

  return {
    state: {
      get<T>(key: string): T | undefined {
        return maps.stateMap.get(extId)?.get(key) as T | undefined;
      },
      set<T>(key: string, value: T): void {
        maps.setExtensionState(extId, key, value);
      },
    },

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

    settings: settingsStore,
  };
}
