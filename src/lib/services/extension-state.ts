/**
 * Extension State Persistence — read/write scoped state to disk.
 *
 * Each extension gets its own state.json at:
 *   ~/.config/gnar-term/extensions/<extension-id>/state.json
 *
 * The in-memory state map in the extension loader remains the source
 * of truth. This service handles disk I/O for durability across restarts.
 */
import { invoke } from "@tauri-apps/api/core";
import { getConfigDir } from "./service-helpers";

// --- Public API ---

export async function getExtensionStatePath(
  extensionId: string,
): Promise<string> {
  const configDir = await getConfigDir();
  return `${configDir}/extensions/${extensionId}/state.json`;
}

export async function loadExtensionState(
  extensionId: string,
): Promise<Record<string, unknown>> {
  const path = await getExtensionStatePath(extensionId);
  try {
    const content = await invoke<string>("read_file", { path });
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function deleteExtensionState(extensionId: string): Promise<void> {
  const configDir = await getConfigDir();
  const dir = `${configDir}/extensions/${extensionId}`;
  try {
    await invoke("remove_dir", { path: dir });
  } catch (err) {
    console.warn(
      `[extension-state] Failed to delete state for ${extensionId}:`,
      err,
    );
  }
}

export async function saveExtensionState(
  extensionId: string,
  state: Record<string, unknown>,
): Promise<void> {
  const configDir = await getConfigDir();
  const dir = `${configDir}/extensions/${extensionId}`;
  const path = `${dir}/state.json`;
  try {
    await invoke("ensure_dir", { path: dir });
    await invoke("write_file", {
      path,
      content: JSON.stringify(state, null, 2),
    });
  } catch (err) {
    console.error(
      `[extension-state] Failed to save state for ${extensionId}:`,
      err,
    );
  }
}
