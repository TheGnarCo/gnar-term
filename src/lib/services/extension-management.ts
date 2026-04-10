/**
 * Extension Management — install, uninstall, and list extensions.
 *
 * Supports installing from a local directory path. The directory must
 * contain a valid extension.json manifest. GitHub install is planned
 * but not yet implemented (requires git clone support in the backend).
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import type {
  ExtensionManifest,
  ExtensionRegisterFn,
} from "../extension-types";
import {
  validateManifest,
  registerExtension,
  activateExtension,
  deactivateExtension,
  unloadExtension,
  extensionStore,
} from "./extension-loader";
import { saveConfig, getConfig } from "../config";
import { deleteExtensionState } from "./extension-state";

export interface InstallResult {
  success: boolean;
  extensionId?: string;
  error?: string;
}

// --- Internal helpers ---

/**
 * Load, parse, and validate an extension manifest + entry point from a directory.
 * Throws on failure with a descriptive error message.
 */
async function loadAndValidateManifest(dirPath: string): Promise<{
  manifest: ExtensionManifest;
  registerFn: ExtensionRegisterFn | undefined;
}> {
  const manifestPath = dirPath.replace(/\/$/, "") + "/extension.json";

  let rawManifest: string;
  try {
    rawManifest = await invoke<string>("read_file", { path: manifestPath });
  } catch (err) {
    throw new Error(`Failed to read manifest: ${err}`);
  }

  let manifest: ExtensionManifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch {
    throw new Error("Invalid JSON in extension.json");
  }

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid manifest: ${validation.errors.join(", ")}`);
  }

  const registerFn = await loadExtensionEntry(dirPath, manifest.entry);
  return { manifest, registerFn };
}

// --- Public API ---

/**
 * Install an extension from a local directory path.
 * Reads extension.json, validates the manifest, and registers it.
 */
export async function installExtensionFromPath(
  dirPath: string,
): Promise<InstallResult> {
  let manifest: ExtensionManifest;
  let registerFn: ExtensionRegisterFn | undefined;

  try {
    ({ manifest, registerFn } = await loadAndValidateManifest(dirPath));
  } catch (err) {
    return { success: false, error: String(err) };
  }

  try {
    registerExtension(manifest, registerFn);
  } catch (err) {
    return { success: false, error: String(err) };
  }

  // Activate immediately so the extension is usable without restart
  let activated = true;
  try {
    await activateExtension(manifest.id);
  } catch (err) {
    activated = false;
    console.warn(
      `[extension-management] Installed "${manifest.id}" but activation failed:`,
      err,
    );
  }

  if (!registerFn) {
    console.warn(
      `[extension-management] Extension "${manifest.id}" installed without a working entry point — it will not run until the entry is fixed`,
    );
  }

  // Persist the extension source in config — mark as disabled if activation failed
  // to prevent persistent boot-time failures on every restart.
  // Re-read config immediately before write to avoid lost updates from concurrent installs.
  const latestCfg = getConfig();
  const extensions = { ...latestCfg.extensions };
  extensions[manifest.id] = { enabled: activated, source: `local:${dirPath}` };
  await saveConfig({ extensions });

  return { success: true, extensionId: manifest.id };
}

/**
 * Uninstall an extension by id. Deactivates and removes from the store.
 */
export async function uninstallExtension(extensionId: string): Promise<void> {
  await unloadExtension(extensionId);

  // Remove from config
  const cfg = getConfig();
  const extensions = { ...cfg.extensions };
  delete extensions[extensionId];
  await saveConfig({ extensions });

  // Clean up state files from disk
  await deleteExtensionState(extensionId);
}

/**
 * Disable an extension without uninstalling it. Deactivates and persists
 * enabled=false in config. The extension remains registered and can be
 * re-enabled without reloading from disk.
 */
export async function disableExtension(extensionId: string): Promise<void> {
  const current = get(extensionStore);
  const ext = current.find((e) => e.manifest.id === extensionId);
  if (!ext) return;

  deactivateExtension(extensionId);

  const cfg = getConfig();
  const extConfig = cfg.extensions?.[extensionId];
  if (extConfig) {
    const extensions = { ...cfg.extensions };
    extensions[extensionId] = { ...extConfig, enabled: false };
    await saveConfig({ extensions });
  }
}

/**
 * Re-enable a disabled extension. Activates and persists enabled=true
 * in config. The extension must already be registered (i.e., previously
 * installed and not uninstalled).
 */
export async function enableExtension(extensionId: string): Promise<void> {
  await activateExtension(extensionId);

  const cfg = getConfig();
  const extConfig = cfg.extensions?.[extensionId];
  if (extConfig) {
    const extensions = { ...cfg.extensions };
    extensions[extensionId] = { ...extConfig, enabled: true };
    await saveConfig({ extensions });
  }
}

/**
 * Load and activate external extensions from config on startup.
 * Reads config.extensions, loads each enabled extension from its source,
 * and activates it. Errors are logged, not thrown — one bad extension
 * should not prevent the others from loading.
 */
export async function loadExternalExtensions(): Promise<void> {
  const cfg = getConfig();
  const extensions = cfg.extensions || {};

  for (const [extId, extConfig] of Object.entries(extensions)) {
    if (!extConfig.enabled) continue;

    // Skip included extensions — they're registered separately in App.svelte
    const alreadyLoaded = get(extensionStore).some(
      (e) => e.manifest.id === extId,
    );
    if (alreadyLoaded) continue;

    if (!extConfig.source) {
      console.warn(
        `[extension-management] No source for extension "${extId}", skipping`,
      );
      continue;
    }

    if (extConfig.source.startsWith("local:")) {
      const dirPath = extConfig.source.slice("local:".length);

      try {
        const { manifest, registerFn } = await loadAndValidateManifest(dirPath);
        if (manifest.id !== extId) {
          console.warn(
            `[extension-management] Config key "${extId}" does not match manifest id "${manifest.id}", updating config to match`,
          );
          // Fix the config so disable/enable can find the extension by its actual ID
          const fixCfg = getConfig();
          const fixExts = { ...fixCfg.extensions };
          fixExts[manifest.id] = { ...fixExts[extId] };
          delete fixExts[extId];
          await saveConfig({ extensions: fixExts });
        }
        registerExtension(manifest, registerFn);
        await activateExtension(manifest.id);
      } catch (err) {
        console.warn(
          `[extension-management] Failed to load extension "${extId}" from ${dirPath}: ${err}`,
        );
      }
    } else {
      console.warn(
        `[extension-management] Unsupported source type for "${extId}": ${extConfig.source}`,
      );
    }
  }
}

/**
 * Get the ids of all currently loaded extensions.
 */
export function getInstalledExtensionIds(): string[] {
  return get(extensionStore).map((e) => e.manifest.id);
}

/**
 * Load an extension's JS entry point from a local directory.
 *
 * Uses convertFileSrc to create an asset:// URL the WebView can import.
 * The entry module must export a default function matching ExtensionRegisterFn.
 * Falls back gracefully if the entry point doesn't exist or has no default export.
 */
async function loadExtensionEntry(
  dirPath: string,
  entry: string,
): Promise<ExtensionRegisterFn | undefined> {
  // Reject traversal attempts at runtime (defense in depth — also checked in validateManifest)
  if (entry.includes("..") || entry.startsWith("/") || entry.startsWith("\\")) {
    console.warn(
      `[extension-management] Rejected entry path with traversal: ${entry}`,
    );
    return undefined;
  }

  // Resolve the entry path relative to the extension directory
  // Normalize backslashes to forward slashes for cross-platform compatibility
  // (convertFileSrc requires forward slashes to produce valid asset:// URLs)
  const normalized = dirPath.replace(/\\/g, "/").replace(/\/$/, "");
  const entryPath = entry.startsWith("./")
    ? `${normalized}/${entry.slice(2)}`
    : `${normalized}/${entry}`;

  // Check if the entry file exists before attempting import
  // (file_exists uses the original path which Rust handles with either separator)
  const exists = await invoke<boolean>("file_exists", { path: entryPath });
  if (!exists) {
    console.warn(
      `[extension-management] Entry point not found: ${entryPath}, registering manifest only`,
    );
    return undefined;
  }

  // Convert to a URL the WebView can load
  const entryUrl = convertFileSrc(entryPath);

  try {
    const module = await import(/* @vite-ignore */ entryUrl);
    if (typeof module.default === "function") {
      return module.default as ExtensionRegisterFn;
    }
    // Also check for a named 'register' export
    if (typeof module.register === "function") {
      return module.register as ExtensionRegisterFn;
    }
    console.warn(
      `[extension-management] Entry point ${entry} has no default or register export`,
    );
    return undefined;
  } catch (err) {
    console.warn(`[extension-management] Failed to import ${entryUrl}:`, err);
    return undefined;
  }
}
