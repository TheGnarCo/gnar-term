/**
 * Legacy `## Active Agents` sections in group Overview markdown get
 * stripped on reconcileGroupDashboards. Older templates emitted this
 * redundantly with the Agentic Dashboard tile; the scrub runs once
 * per reconciliation pass and is idempotent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { reconcileGroupDashboards } from "../lib/services/workspace-group-service";
import { workspaceGroupsStore } from "../lib/stores/workspace-groups";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";

describe("scrub Active Agents from group Overview", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    workspaceGroupsStore.set([
      {
        id: "g1",
        name: "Agent Skills",
        path: "/tmp/agent-skills",
        color: "purple",
        workspaceIds: [],
        isGit: false,
        createdAt: "2026-04-21T00:00:00.000Z",
        dashboardWorkspaceId: "ws-existing",
      },
    ]);
  });

  it("rewrites the Overview markdown when an Active Agents section is present", async () => {
    const stale = [
      "# Agent Skills",
      "",
      "Project at `/tmp/agent-skills`.",
      "",
      "```gnar:workspaces",
      "```",
      "",
      "## Active Agents",
      "",
      "```gnar:agent-list",
      "```",
      "",
      "## Quick Links",
      "",
      "- Local notes",
      "",
    ].join("\n");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_exists") return true;
      if (cmd === "read_file") return stale;
      if (cmd === "write_file") return undefined;
      return undefined;
    });

    await reconcileGroupDashboards();

    const writes = invokeMock.mock.calls.filter(
      (call) => call[0] === "write_file",
    );
    expect(writes).toHaveLength(1);
    const written = writes[0]![1] as { path: string; content: string };
    expect(written.path).toBe(
      "/tmp/agent-skills/.gnar-term/project-dashboard.md",
    );
    expect(written.content).not.toContain("## Active Agents");
    expect(written.content).not.toContain("gnar:agent-list");
    // Surrounding content survives.
    expect(written.content).toContain("# Agent Skills");
    expect(written.content).toContain("## Quick Links");
    expect(written.content).toContain("- Local notes");
  });

  it("leaves the file alone when no Active Agents block is present", async () => {
    const clean = [
      "# Agent Skills",
      "",
      "Project at `/tmp/agent-skills`.",
      "",
      "```gnar:workspaces",
      "```",
      "",
      "## Quick Links",
      "",
      "- Nothing here",
      "",
    ].join("\n");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_exists") return true;
      if (cmd === "read_file") return clean;
      if (cmd === "write_file") return undefined;
      return undefined;
    });

    await reconcileGroupDashboards();

    const writes = invokeMock.mock.calls.filter(
      (call) => call[0] === "write_file",
    );
    expect(writes).toHaveLength(0);
  });
});
