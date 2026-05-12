/**
 * init-agent-status — verifies the per-Workspace agent visibility that
 * ships with core (subtitle + child rows + row renderer). These were
 * previously contributed by the agentic extension; this test pins them
 * to core so the visibility survives even when the extension is absent.
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
import {
  AGENT_STATUS_SOURCE,
  AGENT_ROW_KIND,
} from "../lib/services/agent-status-service";
import {
  workspaceSubtitleStore,
  resetWorkspaceSubtitles,
  unregisterWorkspaceSubtitlesBySource,
} from "../lib/services/workspace-subtitle-registry";
import {
  childRowContributorStore,
  getChildRowsFor,
  resetChildRowContributors,
  unregisterChildRowContributorsBySource,
} from "../lib/services/child-row-contributor-registry";
import {
  rootRowRendererStore,
  getRootRowRenderer,
  unregisterRootRowRenderersBySource,
} from "../lib/services/root-row-renderer-registry";
import {
  setAgentsForTests,
  type DetectedAgent,
} from "../lib/services/agent-detection-service";
import {
  _testHelpers as branchLifecycleTestHelpers,
  resetBranchLifecycleForTests,
} from "../lib/services/branch-lifecycle";
import WorkspaceAgentSubtitle from "../lib/components/WorkspaceAgentSubtitle.svelte";
import WorkspaceAgentRow from "../lib/components/WorkspaceAgentRow.svelte";

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
  resetChildRowContributors();
  unregisterRootRowRenderersBySource(AGENT_STATUS_SOURCE);
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

  it("registers a child-row contributor for parentType 'workspace'", () => {
    initAgentStatus();
    const contributors = get(childRowContributorStore).filter(
      (c) => c.source === AGENT_STATUS_SOURCE,
    );
    expect(contributors).toHaveLength(1);
    expect(contributors[0]!.parentType).toBe("workspace");
  });

  it("registers the agent-row root-row renderer", () => {
    initAgentStatus();
    expect(getRootRowRenderer(AGENT_ROW_KIND)).toBeTruthy();
    expect(
      get(rootRowRendererStore).some(
        (r) => r.id === AGENT_ROW_KIND && r.source === AGENT_STATUS_SOURCE,
      ),
    ).toBe(true);
  });

  it("child-row contributor emits one agent-row per active agent in the workspace", () => {
    initAgentStatus();
    setAgentsForTests([
      makeAgent({ agentId: "a1", workspaceId: "ws-1", status: "active" }),
      makeAgent({
        agentId: "a2",
        workspaceId: "ws-1",
        status: "waiting",
        surfaceId: "surf-2",
        paneId: "pane-2",
      }),
      makeAgent({
        agentId: "a3",
        workspaceId: "ws-other",
        status: "active",
        surfaceId: "surf-3",
        paneId: "pane-3",
      }),
    ]);
    const rows = getChildRowsFor("workspace", "ws-1");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
    expect(rows.every((r) => r.kind === AGENT_ROW_KIND)).toBe(true);
  });

  it("child-row contributor excludes terminal-status agents (errored, completed)", () => {
    initAgentStatus();
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
    const rows = getChildRowsFor("workspace", "ws-1");
    expect(rows.map((r) => r.id)).toEqual(["a3"]);
  });
});

describe("WorkspaceAgentSubtitle", () => {
  beforeEach(() => {
    cleanup();
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

  it("renders the agent count badge when active agents exist", () => {
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
    const badge = container.querySelector("[data-agent-count]");
    expect(badge).toBeTruthy();
    expect(badge!.getAttribute("data-agent-count")).toBe("2");
    expect(badge!.textContent).toMatch(/2\s+agents/);
  });

  it("does not count terminal-status agents toward the badge", () => {
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
    const badge = container.querySelector("[data-agent-count]");
    expect(badge!.getAttribute("data-agent-count")).toBe("1");
    expect(badge!.textContent).toMatch(/1\s+agent/);
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

describe("WorkspaceAgentRow", () => {
  beforeEach(() => {
    cleanup();
    focusSurfaceByIdMock.mockClear();
    resetRegistries();
  });

  it("renders nothing when the agent has exited", () => {
    setAgentsForTests([]);
    const { container } = render(WorkspaceAgentRow, {
      props: { id: "missing-agent" },
    });
    expect(container.querySelector("[data-agent-row]")).toBeNull();
  });

  it("renders agent name and status pill for an active agent", () => {
    setAgentsForTests([
      makeAgent({
        agentId: "a1",
        agentName: "claude",
        workspaceId: "ws-1",
        status: "active",
      }),
    ]);
    const { container } = render(WorkspaceAgentRow, { props: { id: "a1" } });
    const row = container.querySelector("[data-agent-row='a1']");
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("claude");
    const pill = container.querySelector("[data-status]");
    expect(pill!.getAttribute("data-status")).toBe("active");
  });

  it("clicking the row focuses the agent's surface", async () => {
    setAgentsForTests([
      makeAgent({
        agentId: "a1",
        agentName: "claude",
        workspaceId: "ws-1",
        surfaceId: "surf-42",
        status: "active",
      }),
    ]);
    const { container } = render(WorkspaceAgentRow, { props: { id: "a1" } });
    const row = container.querySelector(
      "[data-agent-row='a1']",
    ) as HTMLButtonElement;
    await fireEvent.click(row);
    expect(focusSurfaceByIdMock).toHaveBeenCalledWith("surf-42");
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
    unregisterChildRowContributorsBySource(AGENT_STATUS_SOURCE);
    unregisterRootRowRenderersBySource(AGENT_STATUS_SOURCE);

    expect(
      get(workspaceSubtitleStore).some((s) => s.source === AGENT_STATUS_SOURCE),
    ).toBe(false);
    expect(
      get(childRowContributorStore).some(
        (c) => c.source === AGENT_STATUS_SOURCE,
      ),
    ).toBe(false);
    expect(getRootRowRenderer(AGENT_ROW_KIND)).toBeUndefined();
  });
});
