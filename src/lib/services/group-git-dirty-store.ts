/**
 * Group Git Dirty Store — lightweight reactive signal of "does this
 * workspace group's repo have uncommitted changes right now?" per
 * group path.
 *
 * Consumers: the Diff dashboard tile icon colors itself amber when
 * dirty, default-accent when clean. Other consumers may subscribe for
 * similar passive indicators.
 *
 * Implementation: one readable store per path, memoized. Each store's
 * start function polls `git status --porcelain` every 15 seconds via
 * `run_script` and publishes `{ ready, hasChanges }`. When the last
 * subscriber detaches, Svelte's `readable` stop callback clears the
 * timer — memoization keeps the cache warm across rapid re-subscribes
 * (e.g. sidebar re-renders) without re-seeding the poll loop.
 */
import { readable, type Readable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";

export interface GroupDirtyState {
  /** True after the first poll completes, regardless of result. */
  ready: boolean;
  /** True when `git status --porcelain` returned any non-empty output. */
  hasChanges: boolean;
}

interface ScriptResult {
  stdout: string;
  stderr?: string;
  exit_code: number;
}

const DEFAULT: GroupDirtyState = { ready: false, hasChanges: false };
const POLL_MS = 15_000;

const cache = new Map<string, Readable<GroupDirtyState>>();

export function groupDirtyStore(path: string): Readable<GroupDirtyState> {
  const existing = cache.get(path);
  if (existing) return existing;

  const store = readable<GroupDirtyState>(DEFAULT, (set) => {
    let alive = true;

    const refresh = async (): Promise<void> => {
      try {
        const result = await invoke<ScriptResult>("run_script", {
          cwd: path,
          command: "git status --porcelain=v1",
        });
        if (!alive) return;
        if (!result || result.exit_code !== 0) {
          set({ ready: true, hasChanges: false });
          return;
        }
        set({ ready: true, hasChanges: result.stdout.trim().length > 0 });
      } catch {
        if (alive) set({ ready: true, hasChanges: false });
      }
    };

    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  });

  cache.set(path, store);
  return store;
}

/** Test-only — drop cached stores so the next subscriber seeds a fresh poll. */
export function _resetGroupDirtyStoreCache(): void {
  cache.clear();
}
