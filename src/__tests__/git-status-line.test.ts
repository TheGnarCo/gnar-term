/**
 * GitStatusLine regression tests: ensure normal child workspaces suppress
 * their inline git-info row (the Workspace row shows shared
 * diff/branch state). Worktree child workspaces keep it — branch and
 * dirty state are per-worktree and not redundant with the parent row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import GitStatusLine from "../lib/components/GitStatusLine.svelte";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  setStatusItem,
  clearAllStatusForWorkspace,
} from "../lib/services/status-registry";
import { GIT_STATUS_SOURCE } from "../lib/services/git-status-service";
import type { Workspace } from "../lib/types";

function makeChildWorkspace(
  id: string,
  extraFields: Record<string, unknown> = {},
): Workspace {
  return {
    id,
    name: id,
    layout: { pane: { id: `${id}-pane`, surfaces: [], activeIdx: 0 } },
    ...extraFields,
  } as Workspace;
}

function setDirty(workspaceId: string) {
  setStatusItem(GIT_STATUS_SOURCE, workspaceId, "dirty", {
    category: "dirty",
    priority: 0,
    label: "12·modified",
    variant: "warning",
  });
}

import { get } from "svelte/store";

function activate(wsId: string) {
  const idx = get(workspaces).findIndex((w) => w.id === wsId);
  activeWorkspaceIdx.set(idx);
}

describe("GitStatusLine child workspace rules", () => {
  beforeEach(() => {
    cleanup();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    clearAllStatusForWorkspace("ws-child");
    clearAllStatusForWorkspace("ws-worktree");
    clearAllStatusForWorkspace("ws-root");
  });

  it("hides inline git-info for a normal child workspace (no worktreePath)", () => {
    const ws = makeChildWorkspace("ws-child", { rootWorkspaceId: "p1" });
    workspaces.set([ws]);
    activate(ws.id);
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    expect(container.textContent).not.toMatch(/modified/);
  });

  it("shows worktree branch + dirty for a worktree child workspace when active", () => {
    const ws = makeChildWorkspace("ws-worktree", {
      rootWorkspaceId: "p1",
      worktreePath: "/work/wt",
      branch: "feat/x",
    });
    workspaces.set([ws]);
    activate(ws.id);
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    expect(container.textContent).toMatch(/feat\/x/);
    expect(container.textContent).toMatch(/modified/);
  });

  it("shows only the worktree branch (no dirty) when the workspace is inactive", () => {
    const ws = makeChildWorkspace("ws-worktree", {
      rootWorkspaceId: "p1",
      worktreePath: "/work/wt",
      branch: "feat/x",
    });
    workspaces.set([ws]);
    // leave activeWorkspaceIdx = -1 → workspace is inactive
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    expect(container.textContent).toMatch(/feat\/x/);
    expect(container.textContent).not.toMatch(/modified/);
  });

  it("does not render dirty label for a root workspace — WorkspaceDiffPrSubtitle owns that row", () => {
    const ws = makeChildWorkspace("ws-root", {});
    workspaces.set([ws]);
    activate(ws.id);
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    // Dirty display moved to WorkspaceDiffPrSubtitle; GitStatusLine only shows cwd/branch.
    expect(container.textContent).not.toMatch(/modified/);
  });
});
