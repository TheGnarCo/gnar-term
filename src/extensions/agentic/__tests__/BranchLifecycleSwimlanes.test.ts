import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { writable } from "svelte/store";
import type {
  ExtensionAPI,
  BranchLifecycleEntry,
  AgentRef,
  BranchDescriptorRef,
} from "../../api";
import { EXTENSION_API_KEY } from "../../api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import BranchLifecycleSwimlanes from "../panels/BranchLifecycleSwimlanes.svelte";

function makeEntry(
  lifecycle: BranchLifecycleEntry["lifecycle"],
  prStateKnown = true,
  reason?: string,
): BranchLifecycleEntry {
  return {
    lifecycle,
    prStateKnown,
    lastActivityAt: Date.now(),
    reason,
  };
}

function makeAgent(paneId: string, surfaceId: string): AgentRef {
  return {
    agentId: `agent-${paneId}`,
    agentName: "Test Agent",
    surfaceId,
    paneId,
    workspaceId: "ws-a",
    status: "running",
    createdAt: new Date().toISOString(),
    lastStatusChange: new Date().toISOString(),
  };
}

function makeFakeApi(
  entries: [string, BranchLifecycleEntry][] = [],
  branches: BranchDescriptorRef[] = [],
  agents: AgentRef[] = [],
) {
  const branchLifecycle = writable<Map<string, BranchLifecycleEntry>>(
    new Map(entries),
  );
  const agentsStore = writable<AgentRef[]>(agents);
  const focusSurface = vi.fn();
  const api = {
    branchLifecycle,
    agents: agentsStore,
    listBranches: vi.fn(() => branches),
    focusSurface,
  } as unknown as ExtensionAPI;
  return { api, branchLifecycle, focusSurface };
}

function renderWithApi(api: ExtensionAPI) {
  return render(BranchLifecycleSwimlanes, {
    context: new Map([[EXTENSION_API_KEY, api]]),
  });
}

describe("BranchLifecycleSwimlanes", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the empty state when map is empty", async () => {
    const { api } = makeFakeApi([]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.textContent).toContain("No branches tracked yet.");
  });

  it("renders an entry in the matching column", async () => {
    const { api } = makeFakeApi([["feat/my-branch", makeEntry("active")]]);
    const { container } = renderWithApi(api);
    await tick();
    const column = container.querySelector('[data-lifecycle-column="active"]');
    expect(column).not.toBeNull();
    expect(column!.textContent).toContain("feat/my-branch");
  });

  it("does not render abandoned entries", async () => {
    const { api } = makeFakeApi([
      ["feat/old", makeEntry("abandoned" as BranchLifecycleEntry["lifecycle"])],
    ]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.textContent).not.toContain("feat/old");
  });

  it("shows the hint banner when at least one entry has prStateKnown=false", async () => {
    const { api } = makeFakeApi([
      ["feat/a", makeEntry("active", true)],
      ["feat/b", makeEntry("draft", false)],
    ]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.querySelector("[data-pr-hint]")).not.toBeNull();
  });

  it("does not show the hint banner when all entries have prStateKnown=true", async () => {
    const { api } = makeFakeApi([
      ["feat/a", makeEntry("active", true)],
      ["feat/b", makeEntry("draft", true)],
    ]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.querySelector("[data-pr-hint]")).toBeNull();
  });

  describe("card click → focusSurface", () => {
    it("focuses the agent's surface when a branch card is clicked", async () => {
      const branchId = "feat/clickable";
      const paneId = "pane-1";
      const surfaceId = "surface-1";
      const { api, focusSurface } = makeFakeApi(
        [[branchId, makeEntry("active")]],
        [
          {
            branchId,
            repoPath: "/repo",
            branch: branchId,
            baseBranch: "main",
            paneId,
          },
        ],
        [makeAgent(paneId, surfaceId)],
      );
      const { container } = renderWithApi(api);
      await tick();
      const card = container.querySelector(
        `[data-branch-card="${branchId}"]`,
      ) as HTMLElement | null;
      expect(card).not.toBeNull();
      await fireEvent.click(card!);
      expect(focusSurface).toHaveBeenCalledWith(surfaceId);
    });

    it("is a safe no-op when no agent occupies the branch's pane", async () => {
      const branchId = "feat/stale";
      const { api, focusSurface } = makeFakeApi(
        [[branchId, makeEntry("active")]],
        [
          {
            branchId,
            repoPath: "/repo",
            branch: branchId,
            baseBranch: "main",
            paneId: "pane-dead",
          },
        ],
        [], // no agents in that pane
      );
      const { container } = renderWithApi(api);
      await tick();
      const card = container.querySelector(
        `[data-branch-card="${branchId}"]`,
      ) as HTMLElement | null;
      await fireEvent.click(card!);
      expect(focusSurface).not.toHaveBeenCalled();
    });

    it("is a safe no-op when the branch has no paneId", async () => {
      const branchId = "feat/no-pane";
      const { api, focusSurface } = makeFakeApi(
        [[branchId, makeEntry("draft")]],
        [
          {
            branchId,
            repoPath: "/repo",
            branch: branchId,
            baseBranch: "main",
            paneId: null,
          },
        ],
        [],
      );
      const { container } = renderWithApi(api);
      await tick();
      const card = container.querySelector(
        `[data-branch-card="${branchId}"]`,
      ) as HTMLElement | null;
      await fireEvent.click(card!);
      expect(focusSurface).not.toHaveBeenCalled();
    });
  });
});
