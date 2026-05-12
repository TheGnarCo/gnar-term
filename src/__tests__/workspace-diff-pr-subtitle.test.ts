/**
 * WorkspaceDiffPrSubtitle regression tests: verify the compact diff + PR
 * statusline renders dirty shorthand from the status registry and that
 * its PR row reflects the shared `repoOpenPrsStore` (populated by the
 * core `pr-state-poller`). The component no longer runs its own
 * `gh_list_prs` poll — tests seed the store via the test helper to
 * drive the render.
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
import {
  _seedRepoOpenPrsForTests,
  _resetPrStatePollerForTests,
  pollPrStateOnce,
  type OpenPrListItem,
} from "../lib/services/pr-state-poller";

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

function pr(
  number: number,
  headRefName: string,
  isDraft = false,
): OpenPrListItem {
  return {
    number,
    title: `PR ${number}`,
    state: "OPEN",
    url: `https://example.com/pr/${number}`,
    headRefName,
    isDraft,
  };
}

describe("WorkspaceDiffPrSubtitle", () => {
  beforeEach(() => {
    cleanup();
    statusRegistry.reset();
    clearAllStatusForWorkspace("ws-1");
    _resetPrStatePollerForTests();
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

  it("registers the repoRoot so a subsequent poll fetches PRs for it", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(invoke);
    const { invalidateGhAvailability } =
      await import("../lib/services/gh-availability");
    invalidateGhAvailability();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_prs") return [];
      return null;
    });

    workspaces.set([makeRootWorkspace("ws-1")]);
    setBranch("ws-1", "/repos/project");
    render(WorkspaceDiffPrSubtitle, { props: { workspaceId: "ws-1" } });

    // Let the reactive registration block fire.
    await tick();
    await tick();

    invokeMock.mockClear();
    await pollPrStateOnce();

    const queried = invokeMock.mock.calls.some(
      ([cmd, args]) =>
        cmd === "gh_list_prs" &&
        (args as Record<string, unknown>).repoPath === "/repos/project",
    );
    expect(queried).toBe(true);
  });

  it("renders a hidden placeholder PR row while the store has no entry for the repo", async () => {
    workspaces.set([makeRootWorkspace("ws-1")]);
    setBranch("ws-1", "/repos/placeholder-test");

    const { container } = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-1" },
    });

    await tick();
    await tick();

    expect(container.querySelector("[data-pr-row-placeholder]")).not.toBeNull();
    expect(container.querySelector("[data-pr-row]")).toBeNull();
  });

  it("paints the real PR row when the shared store has an entry for the repo", async () => {
    workspaces.set([makeRootWorkspace("ws-1")]);
    setBranch("ws-1", "/repos/cache-hit-test");
    _seedRepoOpenPrsForTests("/repos/cache-hit-test", [pr(42, "feat-x")]);

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
    // instance with a changing `workspaceId` prop. Deriving `prs` from
    // the live `(repoRoot, repoOpenPrsStore)` pair ensures the displayed
    // list can never be from a different repo root than the one we're
    // currently rendering.
    workspaces.set([makeRootWorkspace("ws-A"), makeRootWorkspace("ws-B")]);
    setBranch("ws-A", "/repos/A");
    setBranch("ws-B", "/repos/B");
    _seedRepoOpenPrsForTests("/repos/A", [pr(11, "feat-a")]);
    _seedRepoOpenPrsForTests("/repos/B", [pr(22, "feat-b")]);

    const view = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-A" },
    });
    await tick();
    expect(view.container.textContent).toMatch(/#11/);

    await view.rerender({ workspaceId: "ws-B" });
    await tick();
    // The displayed PR must not be A's #11 — should be B's #22.
    expect(view.container.textContent).not.toMatch(/#11/);
    expect(view.container.textContent).toMatch(/#22/);
  });

  it("renders every open PR for the repo as a comma-separated list of clickable links", async () => {
    workspaces.set([makeRootWorkspace("ws-1")]);
    setBranch("ws-1", "/repos/multi-pr");
    // Seed in arbitrary order; the poller is responsible for sorting
    // descending by number before publishing, so the store entry is
    // already sorted by the time the component reads it.
    _seedRepoOpenPrsForTests("/repos/multi-pr", [
      pr(141, "feat/pr-list", true),
      pr(139, "feat/agentic-core-refresh"),
      pr(137, "fix/older"),
    ]);

    const { container } = render(WorkspaceDiffPrSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    await tick();

    const links = Array.from(container.querySelectorAll("[data-pr-number]"));
    const numbers = links
      .map((el) => Number(el.getAttribute("data-pr-number")))
      .sort((a, b) => a - b);
    expect(numbers).toEqual([137, 139, 141]);

    const renderedOrder = links.map((el) =>
      Number(el.getAttribute("data-pr-number")),
    );
    expect(renderedOrder).toEqual([141, 139, 137]);

    const text = container.textContent ?? "";
    const commaCount = (text.match(/,/g) ?? []).length;
    expect(commaCount).toBeGreaterThanOrEqual(2);
  });
});
