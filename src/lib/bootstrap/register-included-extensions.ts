/**
 * Register and conditionally activate every included extension.
 *
 * Extensions are registered unconditionally so their manifests appear in
 * the settings UI and the user can enable them later. Activation only
 * runs for extensions that are explicitly `enabled: true` in config —
 * we use an opt-in model so fresh installs start quiet.
 *
 * Errors are reported via `reportExtensionError` and never thrown, so
 * one broken extension can't strand the others. Returns the list of
 * extension ids that failed so callers can react if needed.
 */
import type { GnarTermConfig } from "../config";
import {
  registerExtension,
  activateExtension,
  reportExtensionError,
} from "../services/extension-loader";
import type { ExtensionManifest } from "../extension-types";

type IncludedExtension = readonly [
  ExtensionManifest,
  Parameters<typeof registerExtension>[1],
  string,
];

/**
 * The static list of included extensions. Empty at this layer — the
 * extensions stack populates it. Keeping the wiring in place means
 * the app boots cleanly on just this infra PR and the extensions PR
 * only has to edit this one array.
 */
export const INCLUDED_EXTENSIONS: readonly IncludedExtension[] = [] as const;

export async function registerIncludedExtensions(
  config: GnarTermConfig,
): Promise<string[]> {
  const extConfig = config.extensions || {};
  const failed: string[] = [];
  for (const [manifest, registerFn, label] of INCLUDED_EXTENSIONS) {
    try {
      registerExtension(manifest, registerFn);
      if (extConfig[label]?.enabled) {
        await activateExtension(label);
      }
    } catch (err) {
      console.error(`[app] Failed to load included extension "${label}":`, err);
      reportExtensionError(
        label,
        err instanceof Error ? err.message : String(err),
      );
      failed.push(label);
    }
  }
  return failed;
}
