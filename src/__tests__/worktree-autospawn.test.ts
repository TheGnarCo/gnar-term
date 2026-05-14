/**
 * Tests for the AgentPreset `autoSpawn` hook on worktree workspace creation.
 *
 * The hook lives in `createWorktreeWorkspaceFromConfig` and is gated by:
 *   1. `autoSpawnEligible: true` on the config (opt-in)
 *   2. no explicit `startupCommand` already supplied (preserves caller intent)
 *   3. at least one `AgentPreset` with `autoSpawn: true` in gnar-term.json
 *
 * When all three hold, the new workspace's first terminal surface is created
 * with the preset's resolved startup command + env merged in.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(true),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const { getConfigMock, saveConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn<() => Record<string, unknown>>().mockReturnValue({}),
  saveConfigMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/config", () => ({
  getConfig: getConfigMock,
  saveConfig: saveConfigMock,
}));

const { createWorktreeMock } = vi.hoisted(() => ({
  createWorktreeMock: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/services/worktree-helpers", () => ({
  resolveRepoPath: vi.fn().mockResolvedValue("/repo"),
  promptWorktreeConfig: vi.fn().mockResolvedValue(null),
  createWorktree: createWorktreeMock,
}));

const { createWorkspaceFromDefMock } = vi.hoisted(() => ({
  createWorkspaceFromDefMock: vi.fn().mockResolvedValue("ws-new"),
}));

vi.mock("../lib/services/workspace-runtime-service", () => ({
  createWorkspaceFromDef: createWorkspaceFromDefMock,
  closeWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/stores/ui", () => ({
  showInputPrompt: vi.fn(),
  showFormPrompt: vi.fn(),
  showConfirmPrompt: vi.fn(),
}));

import {
  createWorktreeWorkspaceFromConfig,
  _resetWorktreeService,
} from "../lib/services/worktree-service";
import { workspaces } from "../lib/stores/workspace";

const BASE_CONFIG = {
  repoPath: "/repo",
  branch: "feat/x",
  base: "main",
  worktreePath: "/repo-feat-x",
};

describe("createWorktreeWorkspaceFromConfig — autoSpawn hook", () => {
  beforeEach(() => {
    _resetWorktreeService();
    workspaces.set([]);
    createWorktreeMock.mockClear().mockResolvedValue(true);
    createWorkspaceFromDefMock.mockClear().mockResolvedValue("ws-new");
    getConfigMock.mockReset().mockReturnValue({});
  });

  it("does NOT autoSpawn when autoSpawnEligible is false", async () => {
    getConfigMock.mockReturnValue({
      agents: [
        {
          name: "Claude",
          command: "claude",
          intendedAgent: "claude",
          autoSpawn: true,
        },
      ],
    });

    await createWorktreeWorkspaceFromConfig({ ...BASE_CONFIG });

    const call = createWorkspaceFromDefMock.mock.calls[0]?.[0] as {
      layout: {
        pane: { surfaces: { type: string; command?: string }[] };
      };
    };
    const surface = call.layout.pane.surfaces[0];
    expect(surface.command).toBeUndefined();
  });

  it("does NOT autoSpawn when no preset opts in (autoSpawn !== true)", async () => {
    getConfigMock.mockReturnValue({
      agents: [
        {
          name: "Claude",
          command: "claude",
          intendedAgent: "claude",
          autoSpawn: false,
        },
        {
          name: "Codex",
          command: "codex",
          // autoSpawn omitted
        },
      ],
    });

    await createWorktreeWorkspaceFromConfig({
      ...BASE_CONFIG,
      autoSpawnEligible: true,
    });

    const call = createWorkspaceFromDefMock.mock.calls[0]?.[0] as {
      layout: {
        pane: { surfaces: { type: string; command?: string }[] };
      };
    };
    expect(call.layout.pane.surfaces[0].command).toBeUndefined();
  });

  it("does NOT autoSpawn when caller already supplied startupCommand", async () => {
    getConfigMock.mockReturnValue({
      agents: [
        {
          name: "Claude",
          command: "claude",
          intendedAgent: "claude",
          autoSpawn: true,
          initialPrompt: "should not appear",
        },
      ],
    });

    await createWorktreeWorkspaceFromConfig({
      ...BASE_CONFIG,
      autoSpawnEligible: true,
      startupCommand: "explicit --command",
    });

    const call = createWorkspaceFromDefMock.mock.calls[0]?.[0] as {
      layout: {
        pane: { surfaces: { type: string; command?: string }[] };
      };
    };
    expect(call.layout.pane.surfaces[0].command).toBe("explicit --command");
  });

  it("autoSpawns the first opting-in preset and merges env", async () => {
    getConfigMock.mockReturnValue({
      agents: [
        {
          name: "Skip Me",
          command: "skip",
          autoSpawn: false,
        },
        {
          name: "Default Claude",
          command: "claude --model opus",
          intendedAgent: "claude",
          initialPrompt: "Hi there",
          env: { CLAUDE_MODEL: "opus" },
          autoSpawn: true,
        },
        {
          // Should NOT win even though autoSpawn=true — first match policy.
          name: "Late",
          command: "late",
          autoSpawn: true,
        },
      ],
    });

    await createWorktreeWorkspaceFromConfig({
      ...BASE_CONFIG,
      autoSpawnEligible: true,
      env: { EXISTING: "1" },
    });

    const call = createWorkspaceFromDefMock.mock.calls[0]?.[0] as {
      env: Record<string, string>;
      layout: {
        pane: { surfaces: { type: string; command?: string }[] };
      };
    };
    const surface = call.layout.pane.surfaces[0];
    // Preset's command becomes the launcher; initialPrompt is ANSI-C quoted.
    expect(surface.command).toBeDefined();
    expect(surface.command).toContain("claude --model opus");
    expect(surface.command).toContain("Hi there");
    // Env merges: GNARTERM_WORKTREE_ROOT (worktree default) + caller env + preset env.
    expect(call.env.GNARTERM_WORKTREE_ROOT).toBe("/repo");
    expect(call.env.EXISTING).toBe("1");
    expect(call.env.CLAUDE_MODEL).toBe("opus");
  });
});
