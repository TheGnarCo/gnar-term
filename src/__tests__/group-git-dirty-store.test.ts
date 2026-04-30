/**
 * group-git-dirty-store: dirty signal must match what the diff
 * dashboard actually renders, and must update live as the working
 * tree / git index change.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import {
  groupDirtyStore,
  _resetGroupDirtyStoreCache,
  type GroupDirtyState,
} from "../lib/services/group-git-dirty-store";

interface ScriptResult {
  stdout: string;
  exit_code: number;
}
type FileChangedHandler = (event: {
  payload: { watch_id: number; path: string; content: string };
}) => void;

function captureSubscriber() {
  const states: GroupDirtyState[] = [];
  return {
    states,
    onValue: (v: GroupDirtyState) => void states.push(v),
  };
}

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
  _resetGroupDirtyStoreCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("groupDirtyStore", () => {
  it("flags dirty when `git diff HEAD --quiet` exits 1", async () => {
    invokeMock.mockImplementation((cmd: string, args: { command?: string }) => {
      if (cmd === "run_script" && args.command === "git diff HEAD --quiet") {
        return Promise.resolve<ScriptResult>({ stdout: "", exit_code: 1 });
      }
      if (cmd === "run_script") {
        return Promise.resolve<ScriptResult>({
          stdout: "/repo\n",
          exit_code: 0,
        });
      }
      if (cmd === "watch_file") return Promise.resolve(42);
      return Promise.resolve(undefined);
    });

    const sub = captureSubscriber();
    const stop = groupDirtyStore("/repo").subscribe(sub.onValue);

    await flush();

    expect(sub.states.at(-1)).toEqual({ ready: true, hasChanges: true });
    stop();
  });

  it("flags clean when `git diff HEAD --quiet` exits 0", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "run_script") {
        return Promise.resolve<ScriptResult>({ stdout: "", exit_code: 0 });
      }
      if (cmd === "watch_file") return Promise.resolve(7);
      return Promise.resolve(undefined);
    });

    const sub = captureSubscriber();
    const stop = groupDirtyStore("/clean").subscribe(sub.onValue);
    await flush();

    expect(sub.states.at(-1)).toEqual({ ready: true, hasChanges: false });
    stop();
  });

  it("treats untracked-only repos as clean (matches diff surface contents)", async () => {
    // Simulates a repo whose ONLY dirtiness is `?? new-file.txt`. The
    // diff surface uses `git diff HEAD`, which excludes untracked
    // files — so the tile must NOT light up. `git diff HEAD --quiet`
    // returns 0 in this scenario.
    invokeMock.mockImplementation((cmd: string, args: { command?: string }) => {
      if (cmd === "run_script" && args.command === "git diff HEAD --quiet") {
        return Promise.resolve<ScriptResult>({ stdout: "", exit_code: 0 });
      }
      if (cmd === "run_script") {
        return Promise.resolve<ScriptResult>({
          stdout: "/repo\n",
          exit_code: 0,
        });
      }
      if (cmd === "watch_file") return Promise.resolve(1);
      return Promise.resolve(undefined);
    });

    const sub = captureSubscriber();
    const stop = groupDirtyStore("/untracked-only").subscribe(sub.onValue);
    await flush();

    expect(sub.states.at(-1)?.hasChanges).toBe(false);
    stop();
  });

  it("repolls on .git/index file-changed events for live updates", async () => {
    let exit = 0;
    let handler: FileChangedHandler | null = null;
    listenMock.mockImplementation((event: string, cb: FileChangedHandler) => {
      if (event === "file-changed") handler = cb;
      return Promise.resolve(() => {});
    });
    invokeMock.mockImplementation((cmd: string, args: { command?: string }) => {
      if (cmd === "run_script" && args.command === "git diff HEAD --quiet") {
        return Promise.resolve<ScriptResult>({ stdout: "", exit_code: exit });
      }
      if (cmd === "run_script") {
        return Promise.resolve<ScriptResult>({
          stdout: "/repo\n",
          exit_code: 0,
        });
      }
      if (cmd === "watch_file") return Promise.resolve(99);
      return Promise.resolve(undefined);
    });

    const sub = captureSubscriber();
    const stop = groupDirtyStore("/live").subscribe(sub.onValue);
    await flush();
    expect(sub.states.at(-1)?.hasChanges).toBe(false);

    // Simulate `git add` rewriting .git/index. Watcher fires.
    exit = 1;
    expect(handler).not.toBeNull();
    handler!({
      payload: { watch_id: 99, path: "/repo/.git/index", content: "" },
    });
    // Debounce window inside the store is 150ms.
    await vi.advanceTimersByTimeAsync(200);
    await flush();

    expect(sub.states.at(-1)?.hasChanges).toBe(true);
    stop();
  });

  it("ignores file-changed events for unrelated watch ids", async () => {
    let calls = 0;
    let handler: FileChangedHandler | null = null;
    listenMock.mockImplementation((event: string, cb: FileChangedHandler) => {
      if (event === "file-changed") handler = cb;
      return Promise.resolve(() => {});
    });
    invokeMock.mockImplementation((cmd: string, args: { command?: string }) => {
      if (cmd === "run_script" && args.command === "git diff HEAD --quiet") {
        calls++;
        return Promise.resolve<ScriptResult>({ stdout: "", exit_code: 0 });
      }
      if (cmd === "run_script") {
        return Promise.resolve<ScriptResult>({
          stdout: "/repo\n",
          exit_code: 0,
        });
      }
      if (cmd === "watch_file") return Promise.resolve(11);
      return Promise.resolve(undefined);
    });

    const stop = groupDirtyStore("/scoped").subscribe(() => {});
    await flush();
    const baseline = calls;

    handler!({
      payload: { watch_id: 999, path: "/other/.git/index", content: "" },
    });
    await vi.advanceTimersByTimeAsync(200);
    await flush();

    expect(calls).toBe(baseline);
    stop();
  });

  it("polls on a timer as a working-tree fallback", async () => {
    let calls = 0;
    invokeMock.mockImplementation((cmd: string, args: { command?: string }) => {
      if (cmd === "run_script" && args.command === "git diff HEAD --quiet") {
        calls++;
        return Promise.resolve<ScriptResult>({ stdout: "", exit_code: 0 });
      }
      if (cmd === "run_script") {
        return Promise.resolve<ScriptResult>({
          stdout: "/repo\n",
          exit_code: 0,
        });
      }
      if (cmd === "watch_file") return Promise.resolve(2);
      return Promise.resolve(undefined);
    });

    const stop = groupDirtyStore("/poll").subscribe(() => {});
    await flush();
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(20_000);
    await flush();
    expect(calls).toBe(2);

    await vi.advanceTimersByTimeAsync(20_000);
    await flush();
    expect(calls).toBe(3);
    stop();
  });

  it("clears polling and unwatches on last unsubscribe", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "run_script") {
        return Promise.resolve<ScriptResult>({
          stdout: "/repo\n",
          exit_code: 0,
        });
      }
      if (cmd === "watch_file") return Promise.resolve(55);
      return Promise.resolve(undefined);
    });

    const stop = groupDirtyStore("/cleanup").subscribe(() => {});
    await flush();
    invokeMock.mockClear();
    stop();
    await flush();

    expect(invokeMock).toHaveBeenCalledWith("unwatch_file", { watchId: 55 });

    invokeMock.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    // No further refresh polls after the timer was cleared.
    expect(
      invokeMock.mock.calls.find(
        (c) =>
          c[0] === "run_script" && c[1]?.command === "git diff HEAD --quiet",
      ),
    ).toBeUndefined();
  });
});
