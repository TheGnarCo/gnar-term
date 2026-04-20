/**
 * GitStatusLine regression tests: ensure normal nested workspaces suppress
 * their inline git-info row (the project row shows shared diff/branch
 * state). Worktree nested workspaces keep it — branch and dirty state
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
import { workspaces } from "../lib/stores/workspace";
import {
  setStatusItem,
  clearAllStatusForWorkspace,
} from "../lib/services/status-registry";
import { GIT_STATUS_SOURCE } from "../lib/services/git-status-service";
import type { Workspace } from "../lib/types";

function makeWorkspace(
  id: string,
  metadata: Record<string, unknown> = {},
): Workspace {
  return {
    id,
    name: id,
    layout: { pane: { id: `${id}-pane`, surfaces: [], activeIdx: 0 } },
    metadata,
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

describe("GitStatusLine nested rules", () => {
  beforeEach(() => {
    cleanup();
    workspaces.set([]);
    clearAllStatusForWorkspace("ws-nested");
    clearAllStatusForWorkspace("ws-worktree");
    clearAllStatusForWorkspace("ws-root");
  });

  it("hides inline git-info for a normal nested workspace (no worktreePath)", () => {
    const ws = makeWorkspace("ws-nested", { projectId: "p1" });
    workspaces.set([ws]);
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    expect(container.textContent).not.toMatch(/modified/);
  });

  it("shows worktree branch + dirty for a worktree nested workspace", () => {
    const ws = makeWorkspace("ws-worktree", {
      projectId: "p1",
      worktreePath: "/work/wt",
      branch: "feat/x",
    });
    workspaces.set([ws]);
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    expect(container.textContent).toMatch(/feat\/x/);
    expect(container.textContent).toMatch(/modified/);
  });

  it("still renders full top/bottom rows for a root (non-nested) workspace", () => {
    const ws = makeWorkspace("ws-root", {});
    workspaces.set([ws]);
    setDirty(ws.id);
    const { container } = render(GitStatusLine, {
      props: { workspaceId: ws.id },
    });
    expect(container.textContent).toMatch(/modified/);
  });
});
