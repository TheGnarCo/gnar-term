import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ClaudeDirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function readClaudeFile(path: string): Promise<string> {
  return invoke<string>("read_claude_file", { path });
}

export async function writeClaudeFile(
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_claude_file", { path, content });
}

export async function listClaudeDir(path: string): Promise<ClaudeDirEntry[]> {
  return invoke<ClaudeDirEntry[]>("list_claude_dir", { path });
}

/**
 * Watch a Claude settings file for changes. Returns an unlisten function.
 * Emits when the file is modified externally (debounced, ~500ms).
 */
export async function watchClaudeFile(
  path: string,
  onChange: () => void,
): Promise<() => void> {
  const watchId = await invoke<number>("watch_claude_file", { path });

  const unlisten = await listen<{ watch_id: number; path: string }>(
    "claude-file-changed",
    (event) => {
      if (event.payload.watch_id === watchId) {
        onChange();
      }
    },
  );

  return async () => {
    unlisten();
    await invoke("unwatch_claude_file", { watchId }).catch(() => undefined);
  };
}

export function parseClaudeSettings(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function serializeClaudeSettings(
  settings: Record<string, unknown>,
): string {
  return JSON.stringify(settings, null, 2);
}
