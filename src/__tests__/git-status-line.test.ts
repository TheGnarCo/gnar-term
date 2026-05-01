/**
 * GitStatusLine regression tests: ensure normal nested nestedWorkspaces suppress
 * their inline git-info row (the project row shows shared diff/branch
 * state). Worktree nested nestedWorkspaces keep it — branch and dirty state
 * are per-worktree and not redundant with the project row.
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
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/workspace";
import {
  setStatusItem,
  clearAllStatusForWorkspace,
} from "../lib/services/status-registry";
import { GIT_STATUS_SOURCE } from "../lib/services/git-status-service";
import type { NestedWorkspace } from "../lib/types";

function makeWorkspace(
  id: string,
  metadata: Record<string, unknown> = {},
): NestedWorkspace {
  return {
    id,
    name: id,
    layout: { pane: { id: `${id}-pane`, surfaces: [], activeIdx: 0 } },
    metadata,
  } as NestedWorkspace;
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
  const idx = get(nestedWorkspaces).findIndex((w) => w.id === wsId);
  activeNestedWorkspaceIdx.set(idx);
}

describe("GitStatusLine nested rules", () => {
  beforeEach(() => {
    cleanup();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    clearAllStatusForWorkspace("ws-nested");
    clearAllStatusForWorkspace("ws-worktree");
    clearAllStatusForWorkspace("ws-root");
  });

  it("hides inline git-info for a normal nested workspace (no worktreePath)", () => {
    const ws = makeWorkspace("ws-nested", { groupId: "p1" });
    nestedWorkspaces.set([ws]);
    activate(ws.id);
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    expect(container.textContent).not.toMatch(/modified/);
  });

  it("shows worktree branch + dirty for a worktree nested workspace when active", () => {
    const ws = makeWorkspace("ws-worktree", {
      groupId: "p1",
      worktreePath: "/work/wt",
      branch: "feat/x",
    });
    nestedWorkspaces.set([ws]);
    activate(ws.id);
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    expect(container.textContent).toMatch(/feat\/x/);
    expect(container.textContent).toMatch(/modified/);
  });

  it("shows only the worktree branch (no dirty) when the workspace is inactive", () => {
    const ws = makeWorkspace("ws-worktree", {
      groupId: "p1",
      worktreePath: "/work/wt",
      branch: "feat/x",
    });
    nestedWorkspaces.set([ws]);
    // leave activeNestedWorkspaceIdx = -1 → workspace is inactive
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    expect(container.textContent).toMatch(/feat\/x/);
    expect(container.textContent).not.toMatch(/modified/);
  });

  it("does not render dirty label for a root workspace — WorkspaceDiffPrSubtitle owns that row", () => {
    const ws = makeWorkspace("ws-root", {});
    nestedWorkspaces.set([ws]);
    activate(ws.id);
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    // Dirty display moved to WorkspaceDiffPrSubtitle; GitStatusLine only shows cwd/branch.
    expect(container.textContent).not.toMatch(/modified/);
  });
});
