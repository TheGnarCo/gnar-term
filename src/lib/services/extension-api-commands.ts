import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { PATH_COMMANDS, isBlockedAppPath } from "./extension-constants";
import type { ExtensionAPI } from "../extension-types";
import type { ExtensionMaps } from "./extension-api";

/** Tauri command invocation with allowlist checking, path blocking, and watch tracking. */
export function createCommandAPI(
  extId: string,
  allowedCommands: Set<string>,
  maps: ExtensionMaps,
): Pick<ExtensionAPI, "invoke"> {
  return {
    invoke<T = unknown>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> {
      if (!allowedCommands.has(command)) {
        return Promise.reject(
          new Error(
            `[extension:${extId}] Command "${command}" is not allowed. ` +
              `Allowed commands: ${[...allowedCommands].join(", ")}`,
          ),
        );
      }
      // Block extension access to app config directory for path-bearing commands
      if (PATH_COMMANDS.has(command) && args) {
        const pathArg = (args.path ?? args.dirPath ?? "") as string;
        if (pathArg && isBlockedAppPath(pathArg)) {
          return Promise.reject(
            new Error(
              `[extension:${extId}] Access denied: extensions cannot access the app config directory`,
            ),
          );
        }
      }
      // Track watch_file/unwatch_file for cleanup on deactivation.
      // For watch_file, chain .then() so the ID is tracked before the
      // caller's .then() runs — prevents stale IDs on rapid unwatch.
      if (command === "watch_file") {
        return tauriInvoke<T>(command, args).then((watchId) => {
          maps.watchIds.get(extId)?.add(watchId as number);
          return watchId;
        });
      }
      if (command === "unwatch_file" && args?.watchId != null) {
        maps.watchIds.get(extId)?.delete(args.watchId as number);
      }
      return tauriInvoke<T>(command, args);
    },
  };
}
