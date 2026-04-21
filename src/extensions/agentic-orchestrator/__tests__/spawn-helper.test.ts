/**
 * Tests for spawn-helper — the shared "spawn-into-fresh-worktree-workspace"
 * pipeline used by the MCP `spawn_agent` worktree flag and by the in-app
 * Issues / TaskSpawner widgets.
 *
 * The helper composes createWorktreeWorkspaceFromConfig (worktree-service)
 * with the agent command construction. Tests exercise the composition by
 * mocking the worktree-service and asserting the helper's own outputs:
 *   - Branch defaulting (agent/<agent>/<short-ts>)
 *   - Worktree path derivation (sibling of repo, hyphen-joined branch)
 *   - Startup command construction (quoted taskContext, custom passthrough)
 *   - spawnedBy + groupId metadata propagation
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const { createWorktreeWorkspaceFromConfigMock } = vi.hoisted(() => ({
  createWorktreeWorkspaceFromConfigMock: vi.fn(),
}));

vi.mock("../../../lib/services/worktree-service", () => ({
  createWorktreeWorkspaceFromConfig: createWorktreeWorkspaceFromConfigMock,
}));

import { workspaces } from "../../../lib/stores/workspace";
import type { Workspace } from "../../../lib/types";
import {
  buildStartupCommand,
  quoteTaskForShell,
  spawnAgentInWorktree,
} from "../../../lib/services/spawn-helper";

function seedWorkspaceAfterCreate(workspaceId: string): Workspace {
  const ws: Workspace = {
    id: workspaceId,
    name: "Worktree N",
    activePaneId: "p-1",
    splitRoot: {
      type: "pane",
      pane: {
        id: "p-1",
        activeSurfaceId: "s-1",
        surfaces: [
          {
            kind: "terminal",
            id: "s-1",
            // The shape of these is uninteresting — we only assert against
            // pane/surface IDs, not on terminal internals.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            terminal: {} as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fitAddon: {} as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            searchAddon: {} as any,
            termElement: document.createElement("div"),
            ptyId: -1,
            title: "Shell 1",
            cwd: "/work/proj-feat",
            hasUnread: false,
            opened: false,
          },
        ],
      },
    },
  };
  return ws;
}

describe("spawn-helper: quoteTaskForShell", () => {
  it("wraps simple text in double quotes", () => {
    expect(quoteTaskForShell("hello world")).toBe('"hello world"');
  });

  it("escapes inner double quotes", () => {
    expect(quoteTaskForShell('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("escapes backslashes", () => {
    expect(quoteTaskForShell("path\\to\\thing")).toBe('"path\\\\to\\\\thing"');
  });

  it("preserves newlines", () => {
    expect(quoteTaskForShell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("spawn-helper: buildStartupCommand", () => {
  it("returns bare agent command when no taskContext is provided", () => {
    expect(buildStartupCommand("claude-code", undefined, undefined)).toBe(
      "claude",
    );
    expect(buildStartupCommand("codex", "", undefined)).toBe("codex");
    expect(buildStartupCommand("aider", "   ", undefined)).toBe("aider");
  });

  it("appends quoted taskContext when provided", () => {
    expect(buildStartupCommand("claude-code", "fix the bug", undefined)).toBe(
      'claude "fix the bug"',
    );
  });

  it("escapes inner double quotes in taskContext", () => {
    expect(
      buildStartupCommand("claude-code", 'add "feature X"', undefined),
    ).toBe('claude "add \\"feature X\\""');
  });

  it("custom agent passes the command through verbatim", () => {
    expect(
      buildStartupCommand("custom", "ignored", 'my-script --flag "x"'),
    ).toBe('my-script --flag "x"');
  });

  it("custom agent without command throws", () => {
    expect(() => buildStartupCommand("custom", undefined, undefined)).toThrow(
      /requires a command/,
    );
  });
});

describe("spawn-helper: spawnAgentInWorktree", () => {
  beforeEach(() => {
    createWorktreeWorkspaceFromConfigMock.mockReset();
    workspaces.set([]);
  });

  it("creates a worktree workspace with spawnedBy metadata + correct startup command", async () => {
    const newWsId = "ws-new-1";
    createWorktreeWorkspaceFromConfigMock.mockImplementation(async () => {
      // Simulate worktree-service appending the workspace to the store.
      workspaces.set([seedWorkspaceAfterCreate(newWsId)]);
      return { workspaceId: newWsId };
    });

    const result = await spawnAgentInWorktree({
      name: "claude-code: #1 Fix bug",
      agent: "claude-code",
      taskContext: "Fix the bug from issue #1",
      repoPath: "/work/proj",
      branch: "agent/claude-code/1-fix-bug",
      spawnedBy: { kind: "global" },
    });

    expect(createWorktreeWorkspaceFromConfigMock).toHaveBeenCalledTimes(1);
    const cfg = createWorktreeWorkspaceFromConfigMock.mock.calls[0]?.[0];
    expect(cfg).toMatchObject({
      repoPath: "/work/proj",
      branch: "agent/claude-code/1-fix-bug",
      base: "main",
      worktreePath: "/work/proj-agent-claude-code-1-fix-bug",
      spawnedBy: { kind: "global" },
      startupCommand: 'claude "Fix the bug from issue #1"',
    });

    expect(result).toEqual({
      surface_id: "s-1",
      workspace_id: newWsId,
      pane_id: "p-1",
      branch: "agent/claude-code/1-fix-bug",
      worktree_path: "/work/proj-agent-claude-code-1-fix-bug",
    });
  });

  it("defaults the branch when caller does not supply one", async () => {
    const newWsId = "ws-new-2";
    createWorktreeWorkspaceFromConfigMock.mockImplementation(async () => {
      workspaces.set([seedWorkspaceAfterCreate(newWsId)]);
      return { workspaceId: newWsId };
    });

    const result = await spawnAgentInWorktree({
      name: "codex",
      agent: "codex",
      repoPath: "/work/proj",
    });

    const cfg = createWorktreeWorkspaceFromConfigMock.mock.calls[0]?.[0];
    expect(cfg.branch).toMatch(/^agent\/codex\/[a-z0-9]+$/);
    // Worktree path derives from the (defaulted) branch.
    expect(cfg.worktreePath).toMatch(/^\/work\/proj-agent-codex-[a-z0-9]+$/);
    expect(cfg.startupCommand).toBe("codex");
    expect(result.branch).toBe(cfg.branch);
    expect(result.worktree_path).toBe(cfg.worktreePath);
  });

  it("custom agent uses the provided command verbatim with no quoting", async () => {
    const newWsId = "ws-new-3";
    createWorktreeWorkspaceFromConfigMock.mockImplementation(async () => {
      workspaces.set([seedWorkspaceAfterCreate(newWsId)]);
      return { workspaceId: newWsId };
    });

    await spawnAgentInWorktree({
      name: "custom",
      agent: "custom",
      command: 'my-tool --task "x"',
      // taskContext is intentionally provided to verify it is IGNORED for
      // custom agents (the caller owns the command shape).
      taskContext: "ignored",
      repoPath: "/work/proj",
      branch: "agent/custom/abc",
    });

    const cfg = createWorktreeWorkspaceFromConfigMock.mock.calls[0]?.[0];
    expect(cfg.startupCommand).toBe('my-tool --task "x"');
  });

  it("omits spawnedBy from config when the caller does not provide it", async () => {
    const newWsId = "ws-new-4";
    createWorktreeWorkspaceFromConfigMock.mockImplementation(async () => {
      workspaces.set([seedWorkspaceAfterCreate(newWsId)]);
      return { workspaceId: newWsId };
    });

    await spawnAgentInWorktree({
      name: "aider",
      agent: "aider",
      repoPath: "/work/proj",
      branch: "agent/aider/x",
    });

    const cfg = createWorktreeWorkspaceFromConfigMock.mock.calls[0]?.[0];
    expect(cfg.spawnedBy).toBeUndefined();
  });

  it("propagates spawnedBy={kind:'group', groupId} when a group-scoped caller passes it", async () => {
    const newWsId = "ws-new-5";
    createWorktreeWorkspaceFromConfigMock.mockImplementation(async () => {
      workspaces.set([seedWorkspaceAfterCreate(newWsId)]);
      return { workspaceId: newWsId };
    });

    await spawnAgentInWorktree({
      name: "claude-code",
      agent: "claude-code",
      repoPath: "/work/proj",
      branch: "agent/claude-code/grp",
      groupId: "grp-1",
      spawnedBy: { kind: "group", groupId: "grp-1" },
    });

    const cfg = createWorktreeWorkspaceFromConfigMock.mock.calls[0]?.[0];
    expect(cfg.spawnedBy).toEqual({ kind: "group", groupId: "grp-1" });
    expect(cfg.groupId).toBe("grp-1");
  });

  it("propagates spawnedBy={kind:'global'} and omits groupId for global-scoped spawns", async () => {
    const newWsId = "ws-new-6";
    createWorktreeWorkspaceFromConfigMock.mockImplementation(async () => {
      workspaces.set([seedWorkspaceAfterCreate(newWsId)]);
      return { workspaceId: newWsId };
    });

    await spawnAgentInWorktree({
      name: "aider",
      agent: "aider",
      repoPath: "/work/proj",
      branch: "agent/aider/glob",
      spawnedBy: { kind: "global" },
    });

    const cfg = createWorktreeWorkspaceFromConfigMock.mock.calls[0]?.[0];
    expect(cfg.spawnedBy).toEqual({ kind: "global" });
    expect(cfg.groupId).toBeUndefined();
  });

  it("throws when repoPath is missing", async () => {
    await expect(
      spawnAgentInWorktree({
        name: "x",
        agent: "claude-code",
        repoPath: "",
      }),
    ).rejects.toThrow(/repoPath/);
  });

  it("throws when worktree-service does not produce a workspace id", async () => {
    createWorktreeWorkspaceFromConfigMock.mockResolvedValue({
      workspaceId: "",
    });

    await expect(
      spawnAgentInWorktree({
        name: "x",
        agent: "claude-code",
        repoPath: "/work/proj",
      }),
    ).rejects.toThrow(/workspace id/);
  });
});
