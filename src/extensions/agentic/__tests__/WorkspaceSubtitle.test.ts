import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup } from "@testing-library/svelte";
import { writable } from "svelte/store";
import type {
  ExtensionAPI,
  AgentRef,
  BranchLifecycleEntry,
  BranchDescriptorRef,
} from "../../api";
import { EXTENSION_API_KEY } from "../../api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import WorkspaceSubtitle from "../contributions/WorkspaceSubtitle.svelte";

function makeAgent(overrides: Partial<AgentRef> = {}): AgentRef {
  return {
    agentId: "agent-1",
    agentName: "My Agent",
    surfaceId: "surface-1",
    paneId: "pane-1",
    workspaceId: "ws-a",
    status: "running",
    createdAt: new Date().toISOString(),
    lastStatusChange: new Date().toISOString(),
    ...overrides,
  };
}

function makeFakeApi(
  agents: AgentRef[] = [],
  branchLifecycleEntries: [string, BranchLifecycleEntry][] = [],
  branches: BranchDescriptorRef[] = [],
) {
  const agentsStore = writable<AgentRef[]>(agents);
  const branchLifecycle = writable<Map<string, BranchLifecycleEntry>>(
    new Map(branchLifecycleEntries),
  );
  const listBranches = vi.fn(() => branches);

  const api = {
    agents: agentsStore,
    branchLifecycle,
    listBranches,
  } as unknown as ExtensionAPI;

  return { api, agentsStore, branchLifecycle, listBranches };
}

function renderWithApi(api: ExtensionAPI, workspaceId: string) {
  return render(WorkspaceSubtitle, {
    props: { workspaceId },
    context: new Map([[EXTENSION_API_KEY, api]]),
  });
}

describe("WorkspaceSubtitle", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows 0 agents when no agents exist", async () => {
    const { api } = makeFakeApi([]);
    const { container } = renderWithApi(api, "ws-a");
    await tick();
    const badge = container.querySelector("[data-agent-count]");
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("data-agent-count")).toBe("0");
    expect(badge!.textContent).toContain("0");
  });

  it("shows the count of agents in the given workspace only", async () => {
    const { api } = makeFakeApi([
      makeAgent({ agentId: "a1", workspaceId: "ws-a" }),
      makeAgent({ agentId: "a2", workspaceId: "ws-a" }),
      makeAgent({ agentId: "a3", workspaceId: "ws-a" }),
      makeAgent({ agentId: "b1", workspaceId: "ws-b" }),
    ]);
    const { container } = renderWithApi(api, "ws-a");
    await tick();
    const badge = container.querySelector("[data-agent-count]");
    expect(badge!.getAttribute("data-agent-count")).toBe("3");
  });

  it("excludes terminal-status agents from the count", async () => {
    const { api } = makeFakeApi([
      makeAgent({ agentId: "a1", workspaceId: "ws-a", status: "running" }),
      makeAgent({ agentId: "a2", workspaceId: "ws-a", status: "errored" }),
      makeAgent({ agentId: "a3", workspaceId: "ws-a", status: "completed" }),
    ]);
    const { container } = renderWithApi(api, "ws-a");
    await tick();
    const badge = container.querySelector("[data-agent-count]");
    // Only the running agent is counted.
    expect(badge!.getAttribute("data-agent-count")).toBe("1");
  });

  it("re-renders the count when the agents store updates", async () => {
    const { api, agentsStore } = makeFakeApi([
      makeAgent({ agentId: "a1", workspaceId: "ws-a" }),
    ]);
    const { container } = renderWithApi(api, "ws-a");
    await tick();

    expect(
      container
        .querySelector("[data-agent-count]")!
        .getAttribute("data-agent-count"),
    ).toBe("1");

    agentsStore.update((prev) => [
      ...prev,
      makeAgent({ agentId: "a2", workspaceId: "ws-a" }),
      makeAgent({ agentId: "a3", workspaceId: "ws-a" }),
    ]);
    await tick();

    expect(
      container
        .querySelector("[data-agent-count]")!
        .getAttribute("data-agent-count"),
    ).toBe("3");
  });

  it("does not render a lifecycle pill when no branch can be resolved", async () => {
    const { api } = makeFakeApi(
      [makeAgent({ agentId: "a1", workspaceId: "ws-a", paneId: "pane-1" })],
      [], // no lifecycle entries
      [], // no branches
    );
    const { container } = renderWithApi(api, "ws-a");
    await tick();
    expect(container.querySelector("[data-lifecycle]")).toBeNull();
  });

  it("renders a lifecycle pill when a branch is unambiguously resolved", async () => {
    const entry: BranchLifecycleEntry = {
      lifecycle: "active",
      prStateKnown: true,
      lastActivityAt: Date.now(),
    };
    const branch: BranchDescriptorRef = {
      branchId: "branch-42",
      repoPath: "/repo",
      branch: "feat/x",
      baseBranch: "main",
      paneId: "pane-1",
    };
    const { api } = makeFakeApi(
      [makeAgent({ agentId: "a1", workspaceId: "ws-a", paneId: "pane-1" })],
      [["branch-42", entry]],
      [branch],
    );
    const { container } = renderWithApi(api, "ws-a");
    await tick();
    const pill = container.querySelector("[data-lifecycle]");
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute("data-lifecycle")).toBe("active");
  });

  it("hides the lifecycle pill when multiple branches match (ambiguous)", async () => {
    const entry1: BranchLifecycleEntry = {
      lifecycle: "active",
      prStateKnown: true,
      lastActivityAt: Date.now(),
    };
    const entry2: BranchLifecycleEntry = {
      lifecycle: "draft",
      prStateKnown: true,
      lastActivityAt: Date.now(),
    };
    const { api } = makeFakeApi(
      [
        makeAgent({ agentId: "a1", workspaceId: "ws-a", paneId: "pane-1" }),
        makeAgent({ agentId: "a2", workspaceId: "ws-a", paneId: "pane-2" }),
      ],
      [
        ["branch-1", entry1],
        ["branch-2", entry2],
      ],
      [
        {
          branchId: "branch-1",
          repoPath: "/repo",
          branch: "feat/x",
          baseBranch: "main",
          paneId: "pane-1",
        },
        {
          branchId: "branch-2",
          repoPath: "/repo",
          branch: "feat/y",
          baseBranch: "main",
          paneId: "pane-2",
        },
      ],
    );
    const { container } = renderWithApi(api, "ws-a");
    await tick();
    // Two branches match → ambiguous → pill hidden.
    expect(container.querySelector("[data-lifecycle]")).toBeNull();
  });
});
