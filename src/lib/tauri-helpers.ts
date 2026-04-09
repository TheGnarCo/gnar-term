/**
 * Shared Tauri helpers — utilities used by multiple modules.
 */

import { invoke } from "@tauri-apps/api/core";

let _home = "";

/** Get the user's home directory, cached after first call. */
export async function getHome(): Promise<string> {
  if (_home) return _home;
  try {
    _home = await invoke<string>("get_home");
  } catch {
    _home = "/tmp";
  }
  return _home;
}

/** Reset module state — for tests only */
export function _resetHomeForTesting(): void {
  _home = "";
}
