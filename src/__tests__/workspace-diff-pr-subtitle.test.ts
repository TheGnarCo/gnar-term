/**
 * WorkspaceDiffPrSubtitle regression tests: verify the compact diff + PR
 * statusline renders dirty shorthand from the status registry and that
 * it hides when there is nothing to show.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import { tick } from "svelte";

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
import { workspaces } from "../lib/stores/workspace";
import type { Workspace } from "../lib/types";

function makeRootWorkspace(id: string): Workspace {
  return {
    id,
    name: id,
    paneLayout: {
      type: "pane",
      pane: { id: "p1", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: null,
    path: "/repos/project",
    color: "#aaa",
    isGit: true,
  };
}

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

  it("renders a hidden placeholder PR row while the initial fetch is pending", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(invoke);
    // Never resolve, so prInitialResolved stays false.
    invokeMock.mockImplementation(() => new Promise(() => {}));

    workspaces.set([makeRootWorkspace("ws-1")]);
    setBranch("ws-1", "/repos/placeholder-test");

    const { container } = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-1" },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector("[data-pr-row-placeholder]")).not.toBeNull();
    // Real PR row should not be present yet.
    expect(container.querySelector("[data-pr-row]")).toBeNull();
  });

  it("paints the real PR row synchronously on a second mount via the module-level cache", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(invoke);

    const fakePr = {
      number: 42,
      title: "Cached PR",
      state: "OPEN",
      url: "https://example.com/pr/42",
      headRefName: "feat-x",
      isDraft: false,
      ciStatus: "SUCCESS",
    };
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "gh_view_pr" ? fakePr : null,
    );

    workspaces.set([makeRootWorkspace("ws-1")]);
    setBranch("ws-1", "/repos/cache-hit-test");

    // First mount: trigger fetch and let the module-level cache fill.
    const first = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    // Drain enough microtasks for invoke promise + .then handlers + reactive
    // statements to flush before unmounting.
    await tick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await tick();

    // Sanity check: gh_view_pr fired at least once on first mount and the
    // first call resolved with our fake PR (proving the cache should be
    // populated by now).
    expect(
      invokeMock.mock.calls.some(
        ([cmd, args]) =>
          cmd === "gh_view_pr" &&
          (args as Record<string, unknown>).repoPath ===
            "/repos/cache-hit-test",
      ),
    ).toBe(true);
    expect(first.container.textContent).toMatch(/#42/);

    first.unmount();
    cleanup();

    // Second mount: cache hit should paint the real PR row immediately, with
    // no placeholder reservation. Workspaces store survives across mounts.
    const { container } = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    await tick();

    expect(container.querySelector("[data-pr-row-placeholder]")).toBeNull();
    expect(container.querySelector("[data-pr-row]")).not.toBeNull();
    expect(container.textContent).toMatch(/#42/);
  });

  it("never paints the previous row's PR after the workspaceId prop changes", async () => {
    // Regression: the collapsed-rail popover reuses one subtitle
    // instance with a changing `workspaceId` prop. Imperatively-set
    // `pr` would briefly show row A's PR after switching to row B,
    // until the `repoRoot` reactive chain caught up. The fix derives
    // `pr` from `(repoRoot, prCacheStore)` so the displayed PR can
    // never be from a different repo root than the one we're
    // currently rendering.
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(invoke);

    const prA = {
      number: 11,
      title: "PR A",
      state: "OPEN",
      url: "https://example.com/pr/11",
      headRefName: "feat-a",
      isDraft: false,
      ciStatus: "SUCCESS",
    };
    const prB = {
      number: 22,
      title: "PR B",
      state: "OPEN",
      url: "https://example.com/pr/22",
      headRefName: "feat-b",
      isDraft: false,
      ciStatus: "SUCCESS",
    };
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== "gh_view_pr") return null;
      const path = (args as { repoPath: string }).repoPath;
      if (path === "/repos/A") return prA;
      if (path === "/repos/B") return prB;
      return null;
    });

    workspaces.set([makeRootWorkspace("ws-A"), makeRootWorkspace("ws-B")]);
    setBranch("ws-A", "/repos/A");
    setBranch("ws-B", "/repos/B");

    const view = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-A" },
    });
    // Drain enough microtasks for invoke + reactive flush so #11 lands.
    await tick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await tick();
    expect(view.container.textContent).toMatch(/#11/);

    // Switch the prop without remounting — same instance, new row.
    await view.rerender({ workspaceId: "ws-B" });
    await tick();
    // At this exact moment, the displayed PR must NOT be A's #11.
    // It can be a placeholder, B's #22 from a fresh-cache hit, or
    // null while pending — anything but A's PR data.
    expect(view.container.textContent).not.toMatch(/#11/);

    for (let i = 0; i < 8; i++) await Promise.resolve();
    await tick();
    expect(view.container.textContent).toMatch(/#22/);
  });
});
