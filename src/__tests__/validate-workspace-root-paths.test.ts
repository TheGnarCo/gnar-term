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
import { nestedWorkspaces } from "../lib/stores/nested-workspace";
import { getWorkspaces, setWorkspaces } from "../lib/stores/workspaces";
import { validateWorkspaceRootPaths } from "../lib/services/workspace-service";
import type { Workspace } from "../lib/config";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "g1",
    name: "Workspace 1",
    path: "/tmp/g1",
    color: "blue",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateWorkspaceRootPaths", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    setWorkspaces([]);
    vi.mocked(invoke).mockReset();
  });

  it("stamps pathMissing=true when the workspace path does not exist", async () => {
    setWorkspaces([makeWorkspace({ id: "g1", path: "/tmp/gone" })]);
    vi.mocked(invoke).mockResolvedValue(false);

    await validateWorkspaceRootPaths();

    expect(getWorkspaces()[0]?.pathMissing).toBe(true);
  });

  it("clears pathMissing when the path exists again on a later sweep", async () => {
    setWorkspaces([
      makeWorkspace({ id: "g1", path: "/tmp/back", pathMissing: true }),
    ]);
    vi.mocked(invoke).mockResolvedValue(true);

    await validateWorkspaceRootPaths();

    expect(getWorkspaces()[0]?.pathMissing).toBe(false);
  });

  it("treats a failing invoke as 'not missing' (best-effort)", async () => {
    setWorkspaces([makeWorkspace({ id: "g1", path: "/tmp/transient" })]);
    vi.mocked(invoke).mockRejectedValue(new Error("boom"));

    await validateWorkspaceRootPaths();

    expect(getWorkspaces()[0]?.pathMissing ?? false).toBe(false);
  });

  it("is a no-op when the flag already matches the FS state", async () => {
    setWorkspaces([
      makeWorkspace({ id: "g1", path: "/tmp/here", pathMissing: false }),
    ]);
    vi.mocked(invoke).mockResolvedValue(true);

    const before = getWorkspaces()[0];
    await validateWorkspaceRootPaths();
    const after = getWorkspaces()[0];

    expect(after?.pathMissing).toBe(before?.pathMissing);
  });
});
