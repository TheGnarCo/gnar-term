import { invoke } from "@tauri-apps/api/core";
import { writable } from "svelte/store";
import { getConfigDir } from "./service-helpers";

export interface SessionLogEntry {
  surfaceName: string;
  logPath: string;
  timestamp: number;
}

/**
 * In-memory store of session logs keyed by workspace id.
 * Populated when a workspace branch is closed.
 */
export const sessionLogsStore = writable<Record<string, SessionLogEntry[]>>({});

const MAX_LINES = 1000;

/**
 * Synchronously read up to MAX_LINES from the terminal's scrollback buffer.
 * Must be called BEFORE the terminal is disposed.
 *
 * Returns null if the buffer is absent or contains only whitespace.
 */
export function readTerminalBuffer(surface: unknown): string | null {
  const s = surface as {
    terminal?: {
      buffer?: {
        active?: {
          length: number;
          getLine(
            i: number,
          ): { translateToString(trimRight: boolean): string } | null;
        };
      };
    };
  };

  const buf = s?.terminal?.buffer?.active;
  if (!buf) return null;

  const start = Math.max(0, buf.length - MAX_LINES);
  const lines: string[] = [];
  for (let i = start; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }

  // Trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Async — write captured buffer content to disk and update the store.
 * Safe to call after the synchronous buffer capture (disposal can proceed).
 */
export async function writeSessionLog(
  content: string,
  surfaceName: string,
  surfaceId: string,
  wsId: string,
): Promise<void> {
  try {
    const configDir = await getConfigDir();
    const timestamp = Date.now();
    const logDir = `${configDir}/session-logs`;
    const logPath = `${logDir}/${surfaceId}-${timestamp}.txt`;

    await invoke("ensure_dir", { path: logDir });
    await invoke("write_file", { path: logPath, content });

    sessionLogsStore.update((map) => ({
      ...map,
      [wsId]: [...(map[wsId] ?? []), { surfaceName, logPath, timestamp }],
    }));
  } catch (e) {
    console.warn("[session-log] Failed to write session log:", e);
  }
}
