/**
 * validateWorkspaceRootPaths — startup sweep that stamps `pathMissing: true`
 * on workspaces whose root path no longer exists on disk. Runtime-only flag,
 * idempotent across sweeps.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { invoke } from "@tauri-apps/api/core";
import { workspaces } from "../lib/stores/workspace";
import { getWorkspaces, setWorkspaces } from "../lib/stores/workspace";
import { validateWorkspaceRootPaths } from "../lib/services/workspace-service";
import type { Workspace } from "../lib/config";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "g1",
    name: "Workspace 1",
    path: "/tmp/g1",
    color: "blue",
    branchedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Set up a `vi.mocked(invoke)` implementation that routes by command name.
 * Each command can return a fixed value or throw. Useful because the sweep
 * dispatches to `file_exists`, `get_path_inode`, and `find_dir_by_inode`.
 */
function mockInvokes(handlers: {
  file_exists?: boolean | ((path: string) => boolean | Promise<boolean>);
  get_path_inode?: number | Error | ((path: string) => number);
  find_dir_by_inode?:
    | string
    | null
    | Error
    | ((parent: string, inode: number) => string | null);
}): void {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as {
      path?: string;
      parent?: string;
      inode?: number;
    };
    if (cmd === "file_exists") {
      const h = handlers.file_exists;
      if (typeof h === "function") return await h(a.path ?? "");
      return h ?? true;
    }
    if (cmd === "get_path_inode") {
      const h = handlers.get_path_inode;
      if (h instanceof Error) throw h;
      if (typeof h === "function") return h(a.path ?? "");
      return h ?? 1;
    }
    if (cmd === "find_dir_by_inode") {
      const h = handlers.find_dir_by_inode;
      if (h instanceof Error) throw h;
      if (typeof h === "function") return h(a.parent ?? "", a.inode ?? 0);
      return h ?? null;
    }
    return undefined;
  });
}

describe("validateWorkspaceRootPaths", () => {
  beforeEach(() => {
    workspaces.set([]);
    setWorkspaces([]);
    vi.mocked(invoke).mockReset();
  });

  it("stamps pathMissing=true when the workspace path does not exist and no inode is cached", async () => {
    setWorkspaces([makeWorkspace({ id: "g1", path: "/tmp/gone" })]);
    mockInvokes({ file_exists: false });

    await validateWorkspaceRootPaths();

    expect(getWorkspaces()[0]?.pathMissing).toBe(true);
    expect(getWorkspaces()[0]?.path).toBe("/tmp/gone");
  });

  it("clears pathMissing and caches the inode when the path exists", async () => {
    setWorkspaces([
      makeWorkspace({ id: "g1", path: "/tmp/back", pathMissing: true }),
    ]);
    mockInvokes({ file_exists: true, get_path_inode: 42 });

    await validateWorkspaceRootPaths();

    expect(getWorkspaces()[0]?.pathMissing).toBe(false);
    expect(getWorkspaces()[0]?.pathInode).toBe(42);
  });

  it("treats a failing file_exists invoke as 'not missing' (best-effort)", async () => {
    setWorkspaces([makeWorkspace({ id: "g1", path: "/tmp/transient" })]);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "file_exists") throw new Error("boom");
      if (cmd === "get_path_inode") throw new Error("boom");
      return undefined;
    });

    await validateWorkspaceRootPaths();

    expect(getWorkspaces()[0]?.pathMissing ?? false).toBe(false);
  });

  it("is a no-op when the flag and inode already match the FS state", async () => {
    setWorkspaces([
      makeWorkspace({
        id: "g1",
        path: "/tmp/here",
        pathMissing: false,
        pathInode: 99,
      }),
    ]);
    mockInvokes({ file_exists: true, get_path_inode: 99 });

    const before = getWorkspaces()[0];
    await validateWorkspaceRootPaths();
    const after = getWorkspaces()[0];

    expect(after).toBe(before);
  });

  it("rediscovers a renamed workspace and updates its path", async () => {
    setWorkspaces([
      makeWorkspace({ id: "g1", path: "/tmp/foo", pathInode: 7 }),
    ]);
    mockInvokes({
      file_exists: false,
      find_dir_by_inode: (parent, inode) => {
        expect(parent).toBe("/tmp");
        expect(inode).toBe(7);
        return "/tmp/bar";
      },
    });

    await validateWorkspaceRootPaths();

    expect(getWorkspaces()[0]?.path).toBe("/tmp/bar");
    expect(getWorkspaces()[0]?.pathMissing ?? false).toBe(false);
  });

  it("falls back to pathMissing when rediscovery finds no match", async () => {
    setWorkspaces([
      makeWorkspace({ id: "g1", path: "/tmp/foo", pathInode: 7 }),
    ]);
    mockInvokes({ file_exists: false, find_dir_by_inode: null });

    await validateWorkspaceRootPaths();

    expect(getWorkspaces()[0]?.path).toBe("/tmp/foo");
    expect(getWorkspaces()[0]?.pathMissing).toBe(true);
  });

  it("does not call find_dir_by_inode when no inode is cached", async () => {
    setWorkspaces([makeWorkspace({ id: "g1", path: "/tmp/foo" })]);
    const findSpy = vi.fn().mockResolvedValue(null);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "file_exists") return false;
      if (cmd === "find_dir_by_inode") return findSpy();
      return undefined;
    });

    await validateWorkspaceRootPaths();

    expect(findSpy).not.toHaveBeenCalled();
    expect(getWorkspaces()[0]?.pathMissing).toBe(true);
  });

  it("swallows a failing find_dir_by_inode and stamps pathMissing", async () => {
    setWorkspaces([
      makeWorkspace({ id: "g1", path: "/tmp/foo", pathInode: 7 }),
    ]);
    mockInvokes({
      file_exists: false,
      find_dir_by_inode: new Error("parent unreadable"),
    });

    await validateWorkspaceRootPaths();

    expect(getWorkspaces()[0]?.pathMissing).toBe(true);
  });
});
