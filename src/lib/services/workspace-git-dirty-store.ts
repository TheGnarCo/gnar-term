/**
 * Group Git Dirty Store — reactive signal of "does the diff dashboard
 * for this group currently have anything to show?" per group path.
 *
 * Consumers: the Diff dashboard tile icon colors itself amber when
 * dirty, default-accent when clean.
 *
 * Dirtiness check: `git diff HEAD --quiet` (exit 0 = clean, 1 = dirty).
 * This exactly matches what the diff dashboard renders (`baseBranch:
 * "HEAD"`), which deliberately excludes untracked files. Using
 * `git status --porcelain` here would flag untracked-only repos as
 * dirty even though clicking the tile would open an empty diff.
 *
 * Liveness:
 *   - Initial poll on first subscribe.
 *   - `.git/index` file watcher fires within ~500ms of any git op
 *     (stage, commit, checkout) — sub-second updates without polling.
 *   - 5s poll catches working-tree edits that don't touch the index
 *     (most common case: editing a file in your editor).
 *
 * Memoization: one store per path. The cache stays warm across rapid
 * re-subscribes (sidebar re-renders) so we don't re-seed the polling
 * loop. When the last subscriber detaches, Svelte's `readable` stop
 * callback clears the timer and detaches the watcher.
 */
import { readable, type Readable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface WorkspaceDirtyState {
  /** True after the first poll completes, regardless of result. */
  ready: boolean;
  /** True when `git diff HEAD --quiet` returned exit code 1. */
  hasChanges: boolean;
}

interface ScriptResult {
  stdout: string;
  stderr?: string;
  exit_code: number;
}

interface FileChangedPayload {
  watch_id: number;
  path: string;
  content: string;
}

const DEFAULT: WorkspaceDirtyState = { ready: false, hasChanges: false };
const POLL_MS = 20_000;
const WATCHER_DEBOUNCE_MS = 150;

const cache = new Map<string, Readable<WorkspaceDirtyState>>();

export function workspaceDirtyStore(
  path: string,
): Readable<WorkspaceDirtyState> {
  const existing = cache.get(path);
  if (existing) return existing;

  const store = readable<WorkspaceDirtyState>(DEFAULT, (set) => {
    let alive = true;
    let watchId: number | null = null;
    let unlisten: UnlistenFn | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const refresh = async (): Promise<void> => {
      try {
        const result = await invoke<ScriptResult>("run_script", {
          cwd: path,
          command: "git diff HEAD --quiet",
        });
        if (!alive) return;
        // Exit 0 = clean, 1 = dirty. Anything else (e.g. 128 for
        // non-git dirs / no HEAD) we treat as clean — the tile would
        // open an empty diff in those cases anyway.
        set({ ready: true, hasChanges: result?.exit_code === 1 });
      } catch {
        if (alive) set({ ready: true, hasChanges: false });
      }
    };

    const scheduleRefresh = (): void => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void refresh();
      }, WATCHER_DEBOUNCE_MS);
    };

    const attachIndexWatcher = async (): Promise<void> => {
      try {
        const rootResult = await invoke<ScriptResult>("run_script", {
          cwd: path,
          command: "git rev-parse --show-toplevel",
        });
        if (!alive || !rootResult || rootResult.exit_code !== 0) return;
        const gitRoot = rootResult.stdout.trim();
        if (!gitRoot) return;

        const id = await invoke<number>("watch_file", {
          path: `${gitRoot}/.git/index`,
        });
        if (!alive) {
          // Subscriber gone before watch resolved — undo it.
          try {
            await invoke("unwatch_file", { watchId: id });
          } catch {
            /* ignore */
          }
          return;
        }
        watchId = id;
        unlisten = await listen<FileChangedPayload>("file-changed", (event) => {
          if (event.payload?.watch_id !== id) return;
          scheduleRefresh();
        });
      } catch {
        // Best-effort — polling timer still covers the gap.
      }
    };

    void refresh();
    void attachIndexWatcher();
    const timer = setInterval(() => void refresh(), POLL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      if (unlisten) {
        try {
          unlisten();
        } catch {
          /* ignore */
        }
        unlisten = null;
      }
      if (watchId !== null) {
        const id = watchId;
        watchId = null;
        void invoke("unwatch_file", { watchId: id }).catch(() => {
          /* ignore */
        });
      }
    };
  });

  cache.set(path, store);
  return store;
}

/** Evict a path from the cache when its group is deleted. */
export function releaseWorkspaceDirtyStore(path: string): void {
  cache.delete(path);
}

/** Test-only — drop cached stores so the next subscriber seeds a fresh poll. */
export function _resetWorkspaceDirtyStoreCache(): void {
  cache.clear();
}
