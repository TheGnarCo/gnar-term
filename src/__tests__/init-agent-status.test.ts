/**
 * init-agent-status — verifies the per-Workspace agent visibility that
 * ships with core. The bootstrap registers a single workspace subtitle
 * that renders the count badge, the branch-lifecycle pill, and one
 * inline row per active agent. Active agents no longer appear as
 * child rows in the sector below the banner.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import { render, cleanup, fireEvent } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const focusSurfaceByIdMock = vi.fn();
vi.mock("../lib/services/surface-service", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/services/surface-service")
  >("../lib/services/surface-service");
  return {
    ...actual,
    focusSurfaceById: (id: string) => focusSurfaceByIdMock(id),
  };
});

import { initAgentStatus } from "../lib/bootstrap/init-agent-status";
import { AGENT_STATUS_SOURCE } from "../lib/services/agent-status-service";
import {
  workspaceSubtitleStore,
  resetWorkspaceSubtitles,
  unregisterWorkspaceSubtitlesBySource,
} from "../lib/services/workspace-subtitle-registry";
import {
  setAgentsForTests,
  type DetectedAgent,
} from "../lib/services/agent-detection-service";
import {
  _testHelpers as branchLifecycleTestHelpers,
  resetBranchLifecycleForTests,
} from "../lib/services/branch-lifecycle";
import WorkspaceAgentSubtitle from "../lib/components/WorkspaceAgentSubtitle.svelte";

function makeAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return {
    agentId: "a1",
    agentName: "claude",
    agentType: "generic",
    surfaceId: "surf-1",
    paneId: "pane-1",
    workspaceId: "ws-1",
    status: "active",
    createdAt: new Date(0).toISOString(),
    lastStatusChange: new Date(0).toISOString(),
    ...overrides,
  };
}

function resetRegistries() {
  resetWorkspaceSubtitles();
  setAgentsForTests([]);
  resetBranchLifecycleForTests();
}

describe("initAgentStatus() registration", () => {
  beforeEach(() => {
    cleanup();
    focusSurfaceByIdMock.mockClear();
    resetRegistries();
  });

  it("registers a workspace subtitle under core:agent-status", () => {
    initAgentStatus();
    const subtitle = get(workspaceSubtitleStore).find(
      (s) => s.id === `${AGENT_STATUS_SOURCE}:subtitle`,
    );
    expect(subtitle).toBeTruthy();
    expect(subtitle!.source).toBe(AGENT_STATUS_SOURCE);
  });
});

describe("WorkspaceAgentSubtitle", () => {
  beforeEach(() => {
    cleanup();
    focusSurfaceByIdMock.mockClear();
    resetRegistries();
  });

  it("renders nothing when the workspace has no active agents and no lifecycle pill", () => {
    setAgentsForTests([]);
    const { container } = render(WorkspaceAgentSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    expect(
      container.querySelector("[data-workspace-agent-subtitle]"),
    ).toBeNull();
  });

  it("exposes the active agent count on the container as data-agent-count", () => {
    setAgentsForTests([
      makeAgent({ agentId: "a1", workspaceId: "ws-1", status: "active" }),
      makeAgent({
        agentId: "a2",
        workspaceId: "ws-1",
        status: "waiting",
        surfaceId: "surf-2",
        paneId: "pane-2",
      }),
    ]);
    const { container } = render(WorkspaceAgentSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    const root = container.querySelector("[data-workspace-agent-subtitle]");
    expect(root).toBeTruthy();
    expect(root!.getAttribute("data-agent-count")).toBe("2");
  });

  it("does not count terminal-status agents toward the active count", () => {
    setAgentsForTests([
      makeAgent({ agentId: "a1", workspaceId: "ws-1", status: "active" }),
      makeAgent({
        agentId: "a2",
        workspaceId: "ws-1",
        status: "completed",
        surfaceId: "surf-2",
        paneId: "pane-2",
      }),
    ]);
    const { container } = render(WorkspaceAgentSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    const root = container.querySelector("[data-workspace-agent-subtitle]");
    expect(root!.getAttribute("data-agent-count")).toBe("1");
  });

  it("renders distinct title-cased statuses comma-separated (no chip, no name)", () => {
    setAgentsForTests([
      makeAgent({
        agentId: "a1",
        agentName: "claude",
        workspaceId: "ws-1",
        status: "active",
      }),
      makeAgent({
        agentId: "a2",
        agentName: "gemini",
        workspaceId: "ws-1",
        status: "waiting",
        surfaceId: "surf-2",
        paneId: "pane-2",
      }),
    ]);
    const { container } = render(WorkspaceAgentSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    const rows = container.querySelectorAll("[data-agent-row]");
    expect(rows).toHaveLength(1);
    const status = container.querySelector("[data-status]");
    expect(status).toBeTruthy();
    // waiting takes precedence in the dominant-bucket attribute.
    expect(status!.getAttribute("data-status")).toBe("attention");
    // Distinct buckets joined in precedence order, title-cased.
    expect(status!.textContent?.trim()).toBe("Waiting, Running");
    // No agent names rendered inline.
    expect(container.textContent ?? "").not.toContain("claude");
    expect(container.textContent ?? "").not.toContain("gemini");
  });

  it("collapses duplicate buckets when multiple agents share a status", () => {
    setAgentsForTests([
      makeAgent({ agentId: "a1", workspaceId: "ws-1", status: "active" }),
      makeAgent({
        agentId: "a2",
        workspaceId: "ws-1",
        status: "running",
        surfaceId: "surf-2",
        paneId: "pane-2",
      }),
    ]);
    const { container } = render(WorkspaceAgentSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    const status = container.querySelector("[data-status]");
    expect(status!.textContent?.trim()).toBe("Running");
  });

  it("excludes terminal-status agents from the aggregate status", () => {
    setAgentsForTests([
      makeAgent({ agentId: "a1", workspaceId: "ws-1", status: "errored" }),
      makeAgent({
        agentId: "a2",
        workspaceId: "ws-1",
        status: "completed",
        surfaceId: "surf-2",
        paneId: "pane-2",
      }),
      makeAgent({
        agentId: "a3",
        workspaceId: "ws-1",
        status: "active",
        surfaceId: "surf-3",
        paneId: "pane-3",
      }),
    ]);
    const { container } = render(WorkspaceAgentSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    const status = container.querySelector("[data-status]");
    expect(status!.getAttribute("data-status")).toBe("thinking");
    expect(status!.textContent?.trim()).toBe("Running");
  });

  it("clicking the row focuses the first active agent's surface", async () => {
    setAgentsForTests([
      makeAgent({
        agentId: "a1",
        agentName: "claude",
        workspaceId: "ws-1",
        surfaceId: "surf-42",
        status: "active",
      }),
    ]);
    const { container } = render(WorkspaceAgentSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    const row = container.querySelector(
      "[data-agent-row='ws-1']",
    ) as HTMLButtonElement;
    await fireEvent.click(row);
    expect(focusSurfaceByIdMock).toHaveBeenCalledWith("surf-42");
  });

  it("renders the lifecycle pill when exactly one workspace branch matches a pane", async () => {
    setAgentsForTests([
      makeAgent({
        agentId: "a1",
        workspaceId: "ws-1",
        paneId: "pane-1",
        status: "active",
      }),
    ]);
    await branchLifecycleTestHelpers.seedBranch("branch-1", {
      repoPath: "/repo",
      branch: "feat/x",
      baseBranch: "main",
      hasCommits: true,
      prState: null,
      lastActivityAt: 0,
      paneId: "pane-1",
    });
    const { container } = render(WorkspaceAgentSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    const pill = container.querySelector("[data-lifecycle]");
    expect(pill).toBeTruthy();
    expect(pill!.getAttribute("data-lifecycle")).toBeTruthy();
  });

  it("hides the lifecycle pill when multiple branches match (ambiguous)", async () => {
    setAgentsForTests([
      makeAgent({
        agentId: "a1",
        workspaceId: "ws-1",
        paneId: "pane-1",
        status: "active",
      }),
      makeAgent({
        agentId: "a2",
        workspaceId: "ws-1",
        paneId: "pane-2",
        status: "active",
        surfaceId: "surf-2",
      }),
    ]);
    await branchLifecycleTestHelpers.seedBranch("branch-1", {
      repoPath: "/repo",
      branch: "feat/x",
      baseBranch: "main",
      hasCommits: true,
      prState: null,
      lastActivityAt: 0,
      paneId: "pane-1",
    });
    await branchLifecycleTestHelpers.seedBranch("branch-2", {
      repoPath: "/repo",
      branch: "feat/y",
      baseBranch: "main",
      hasCommits: true,
      prState: null,
      lastActivityAt: 0,
      paneId: "pane-2",
    });
    const { container } = render(WorkspaceAgentSubtitle, {
      props: { workspaceId: "ws-1" },
    });
    expect(container.querySelector("[data-lifecycle]")).toBeNull();
  });
});

describe("init-agent-status integration with workspace-subtitle-registry", () => {
  beforeEach(() => {
    cleanup();
    resetRegistries();
  });

  it("is removable via unregisterBySource (clean teardown)", () => {
    initAgentStatus();
    expect(
      get(workspaceSubtitleStore).some((s) => s.source === AGENT_STATUS_SOURCE),
    ).toBe(true);

    unregisterWorkspaceSubtitlesBySource(AGENT_STATUS_SOURCE);

    expect(
      get(workspaceSubtitleStore).some((s) => s.source === AGENT_STATUS_SOURCE),
    ).toBe(false);
  });
});
