/**
 * WorkspaceDiffPrSubtitle regression tests: verify the compact diff + PR
 * statusline renders dirty shorthand from the status registry and that
 * it hides when there is nothing to show.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import WorkspaceDiffPrSubtitle from "../lib/components/WorkspaceDiffPrSubtitle.svelte";
import {
  setStatusItem,
  clearAllStatusForWorkspace,
  statusRegistry,
} from "../lib/services/status-registry";
import { GIT_STATUS_SOURCE } from "../lib/services/git-status-service";

function setDirty(workspaceId: string, label = "M3 A1") {
  setStatusItem(GIT_STATUS_SOURCE, workspaceId, "dirty", {
    category: "git",
    priority: 30,
    label,
    variant: "warning",
  });
}

function setBranch(workspaceId: string, repoRoot = "/repos/project") {
  setStatusItem(GIT_STATUS_SOURCE, workspaceId, "branch", {
    category: "git",
    priority: 10,
    label: "main",
    metadata: { repoRoot },
  });
}

describe("WorkspaceDiffPrSubtitle", () => {
  beforeEach(() => {
    cleanup();
    statusRegistry.reset();
    clearAllStatusForWorkspace("ws-1");
  });

  it("renders dirty shorthand when the status registry has a dirty item", () => {
    setDirty("ws-1", "M3 A1");
    const { container } = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    expect(container.textContent).toMatch(/M3 A1/);
  });

  it("renders nothing when there is no dirty item and no PR", () => {
    const { container } = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    expect(container.textContent?.trim()).toBe("");
  });

  it("starts PR polling when a branch item with repoRoot is set", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(invoke);

    setBranch("ws-1", "/repos/project");

    render(WorkspaceDiffPrSubtitle, { props: { workspaceId: "ws-1" } });

    // Drain microtask queue so the reactive $: if (repoRoot) block fires.
    await Promise.resolve();
    await Promise.resolve();

    const called = invokeMock.mock.calls.some(
      ([cmd, args]) =>
        cmd === "gh_view_pr" &&
        (args as Record<string, unknown>).repoPath === "/repos/project",
    );
    expect(called).toBe(true);
  });
});
