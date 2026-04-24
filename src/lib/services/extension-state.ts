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

/**
 * Legacy extension-id migrations. Keyed by the new id; each entry
 * identifies the old id and the intra-state key renames to apply. Runs
 * only when the new-id state file is missing — so the migration fires
 * exactly once per install and never overwrites a caller's later edits
 * under the new id.
 */
const LEGACY_EXTENSION_MIGRATIONS: Record<
  string,
  { legacyId: string; keyRenames: Record<string, string> }
> = {
  "workspace-groups": {
    legacyId: "project-scope",
    keyRenames: {
      projects: "workspaceGroups",
      projectOrder: "workspaceGroupOrder",
      activeProjectId: "activeGroupId",
    },
  },
};

async function readStateFile(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const content = await invoke<string>("read_file", { path });
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function loadExtensionState(
  extensionId: string,
): Promise<Record<string, unknown>> {
  const path = await getExtensionStatePath(extensionId);
  const current = await readStateFile(path);
  if (current !== null) return current;

  // Fall back to a legacy extension id, if one is registered. Copy the
  // payload forward (with key renames) and persist to the new location
  // so subsequent loads read from the canonical path directly.
  const migration = LEGACY_EXTENSION_MIGRATIONS[extensionId];
  if (!migration) return {};

  const legacyPath = await getExtensionStatePath(migration.legacyId);
  const legacy = await readStateFile(legacyPath);
  if (legacy === null) return {};

  const migrated: Record<string, unknown> = {};
  for (const [oldKey, value] of Object.entries(legacy)) {
    const newKey = migration.keyRenames[oldKey] ?? oldKey;
    migrated[newKey] = value;
  }
  await saveExtensionState(extensionId, migrated);
  return migrated;
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
