/**
 * PathStatusLine regression: the workspace banner's branch row reads
 * the live `:branch` status item published by git-status-service from
 * the active terminal's CWD, not the workspace's static path. Mutating
 * the registry must propagate to the rendered banner so that `cd`
 * between worktrees inside a workspace updates the displayed branch.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import { tick } from "svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import PathStatusLineHarness from "./path-status-line-harness.svelte";
import {
  setStatusItem,
  clearAllStatusForWorkspace,
} from "../lib/services/status-registry";
import { GIT_STATUS_SOURCE } from "../lib/services/git-status-service";

function setBranch(workspaceId: string, label: string) {
  setStatusItem(GIT_STATUS_SOURCE, workspaceId, "branch", {
    category: "git",
    priority: 10,
    label,
  });
}

describe("PathStatusLine — banner branch tracks live status registry", () => {
  beforeEach(() => {
    cleanup();
    clearAllStatusForWorkspace("ws-path-1");
  });

  it("renders the branch label from the registry", async () => {
    setBranch("ws-path-1", "feat/initial");
    const { container } = render(PathStatusLineHarness, {
      props: {
        target: { id: "ws-path-1", path: "/Users/me/Code/repo", isGit: true },
      },
    });
    await tick();
    expect(container.textContent).toMatch(/feat\/initial/);
  });

  it("strips the ` +N -M` ahead/behind suffix from the registry label", async () => {
    setBranch("ws-path-1", "main +2 -1");
    const { container } = render(PathStatusLineHarness, {
      props: {
        target: { id: "ws-path-1", path: "/Users/me/Code/repo", isGit: true },
      },
    });
    await tick();
    expect(container.textContent).toMatch(/main/);
    expect(container.textContent).not.toMatch(/\+2/);
    expect(container.textContent).not.toMatch(/-1/);
  });

  it("re-renders when the registry's branch label changes (CWD switched worktrees)", async () => {
    setBranch("ws-path-1", "main");
    const { container } = render(PathStatusLineHarness, {
      props: {
        target: { id: "ws-path-1", path: "/Users/me/Code/repo", isGit: true },
      },
    });
    await tick();
    expect(container.textContent).toMatch(/main/);

    setBranch("ws-path-1", "feat/new-worktree");
    await tick();
    expect(container.textContent).toMatch(/feat\/new-worktree/);
    expect(container.textContent).not.toMatch(/\bmain\b/);
  });
});
