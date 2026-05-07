import { configStore as configStoreReadable, getConfig } from "../config";
import type { Readable } from "svelte/store";
import type {
  ExtensionManifest,
  ExtensionAPI,
  ExtensionSettingsField,
} from "../extension-types";
import type { ExtensionMaps } from "./extension-api";

/**
 * Coerce a raw config value into the declared field type. Returns the
 * original value when no field is declared — we only coerce what the
 * extension has explicitly typed.
 *
 * This is a trust-but-coerce boundary: the config file lives on disk
 * and may be hand-edited, so booleans can land as strings, numbers as
 * strings, etc. Rather than surface a type error to the extension,
 * coerce to the declared type and fall back to the field default on
 * failure.
 */
function coerceSettingValue(
  value: unknown,
  field: ExtensionSettingsField | undefined,
): unknown {
  if (!field) return value;
  switch (field.type) {
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return field.default ?? false;
    case "number": {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
      return field.default ?? 0;
    }
    case "string":
    case "select":
      if (typeof value === "string") return value;
      if (value === undefined || value === null) return field.default ?? "";
      return String(value);
  }
}

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
      const field = manifest.contributes?.settings?.fields?.[key];
      if (extSettings && key in extSettings) {
        return coerceSettingValue(extSettings[key], field) as T;
      }
      return field?.default as T | undefined;
    },

    getSettings(): Record<string, unknown> {
      const cfg = getConfig();
      const extSettings = cfg.extensions?.[extId]?.settings || {};
      // Merge defaults from manifest for any missing keys; coerce stored
      // values against their declared type so the extension always sees
      // the shape it expects.
      const fields = manifest.contributes?.settings?.fields || {};
      const result: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(fields)) {
        result[key] =
          key in extSettings
            ? coerceSettingValue(extSettings[key], field)
            : field.default;
      }
      return result;
    },

    settings: settingsStore,
  };
}
