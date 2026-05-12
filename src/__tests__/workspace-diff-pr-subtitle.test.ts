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
        cmd === "gh_list_prs" &&
        (args as Record<string, unknown>).repoPath === "/repos/project" &&
        (args as Record<string, unknown>).state === "open",
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

    const fakePrs = [
      {
        number: 42,
        title: "Cached PR",
        state: "OPEN",
        url: "https://example.com/pr/42",
        headRefName: "feat-x",
        isDraft: false,
      },
    ];
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "gh_list_prs" ? fakePrs : null,
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

    // Sanity check: gh_list_prs fired at least once on first mount and the
    // first call resolved with our fake PRs (proving the cache should be
    // populated by now).
    expect(
      invokeMock.mock.calls.some(
        ([cmd, args]) =>
          cmd === "gh_list_prs" &&
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
    // `prs` would briefly show row A's PRs after switching to row B,
    // until the `repoRoot` reactive chain caught up. The fix derives
    // `prs` from `(repoRoot, prCacheStore)` so the displayed list can
    // never be from a different repo root than the one we're
    // currently rendering.
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(invoke);

    const prsA = [
      {
        number: 11,
        title: "PR A",
        state: "OPEN",
        url: "https://example.com/pr/11",
        headRefName: "feat-a",
        isDraft: false,
      },
    ];
    const prsB = [
      {
        number: 22,
        title: "PR B",
        state: "OPEN",
        url: "https://example.com/pr/22",
        headRefName: "feat-b",
        isDraft: false,
      },
    ];
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== "gh_list_prs") return null;
      const path = (args as { repoPath: string }).repoPath;
      if (path === "/repos/A") return prsA;
      if (path === "/repos/B") return prsB;
      return [];
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

  it("renders every open PR for the repo as a comma-separated list of clickable links", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(invoke);

    const allOpen = [
      {
        number: 139,
        title: "feat: agentic core refresh",
        state: "OPEN",
        url: "https://example.com/pr/139",
        headRefName: "feat/agentic-core-refresh",
        isDraft: false,
      },
      {
        number: 141,
        title: "feat: comma-sep PRs",
        state: "OPEN",
        url: "https://example.com/pr/141",
        headRefName: "feat/pr-list",
        isDraft: true,
      },
      {
        number: 137,
        title: "fix: old PR",
        state: "OPEN",
        url: "https://example.com/pr/137",
        headRefName: "fix/older",
        isDraft: false,
      },
    ];
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "gh_list_prs" ? allOpen : null,
    );

    workspaces.set([makeRootWorkspace("ws-1")]);
    setBranch("ws-1", "/repos/multi-pr");

    const { container } = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    await tick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await tick();

    // Every PR number should be rendered, each as its own clickable span.
    const links = Array.from(container.querySelectorAll("[data-pr-number]"));
    const numbers = links
      .map((el) => Number(el.getAttribute("data-pr-number")))
      .sort((a, b) => a - b);
    expect(numbers).toEqual([137, 139, 141]);

    // Sorted descending by PR number — the rendered order should be 141, 139, 137.
    const renderedOrder = links.map((el) =>
      Number(el.getAttribute("data-pr-number")),
    );
    expect(renderedOrder).toEqual([141, 139, 137]);

    // Comma separators appear between PRs (n-1 commas for n PRs).
    const text = container.textContent ?? "";
    const commaCount = (text.match(/,/g) ?? []).length;
    expect(commaCount).toBeGreaterThanOrEqual(2);
  });
});
