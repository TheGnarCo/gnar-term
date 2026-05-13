import { describe, it, expect, vi, beforeEach } from "vitest";
import { writable } from "svelte/store";
import type { ExtensionAPI, AgentPresetRef, WorkspaceRef } from "../../api";

import { openBotTaskFlow } from "../header/bot-task-flow";

function makePreset(overrides: Partial<AgentPresetRef> = {}): AgentPresetRef {
  return {
    name: "My Agent",
    command: "claude",
    env: { FOO: "bar" },
    ...overrides,
  };
}

function makeFakeApi(
  presets: AgentPresetRef[] = [],
  cwd: string = "/home/user/my-repo",
  activeWorkspaceValue: WorkspaceRef | null = null,
) {
  const agentPresets = writable<AgentPresetRef[]>(presets);
  const activeWorkspace = writable<WorkspaceRef | null>(activeWorkspaceValue);
  const getActiveCwd = vi.fn().mockResolvedValue(cwd);
  const showFormPrompt = vi.fn().mockResolvedValue({
    name: "feat/cool",
    base: "main",
    preset: "My Agent",
    task: "",
  });
  const invoke = vi.fn().mockResolvedValue(undefined);
  const createWorkspaceFromDef = vi.fn().mockResolvedValue("ws-new");
  const reportError = vi.fn();
  const deriveWorktreePath = vi.fn(
    (repoPath: string, branch: string) =>
      `${repoPath}-${branch.replace(/[/\\]/g, "-")}`,
  );

  const api = {
    agentPresets,
    activeWorkspace,
    getActiveCwd,
    showFormPrompt,
    invoke,
    createWorkspaceFromDef,
    reportError,
    deriveWorktreePath,
  } as unknown as ExtensionAPI;

  return {
    api,
    activeWorkspace,
    getActiveCwd,
    showFormPrompt,
    invoke,
    createWorkspaceFromDef,
    reportError,
    deriveWorktreePath,
  };
}

describe("openBotTaskFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses 'New Bot Task' as the dialog title", async () => {
    const { api, showFormPrompt } = makeFakeApi([makePreset()]);
    showFormPrompt.mockResolvedValue(null);
    await openBotTaskFlow(api);
    expect(showFormPrompt.mock.calls[0][0]).toBe("New Bot Task");
  });

  it("populates the preset picker from built-in defaults when user list is empty", async () => {
    const { api, showFormPrompt } = makeFakeApi([]);
    showFormPrompt.mockResolvedValue(null);
    await openBotTaskFlow(api);

    const fields = showFormPrompt.mock.calls[0][1] as Array<{
      key: string;
      type?: string;
      options?: Array<{ value: string }>;
    }>;
    const presetField = fields.find((f) => f.key === "preset")!;
    expect(presetField.type).toBe("select");
    const values = (presetField.options ?? []).map((o) => o.value);
    expect(values).toContain("Claude Code");
    expect(values).toContain("Codex");
  });

  it("prefers user-configured presets over defaults when both could apply", async () => {
    const userPreset = makePreset({ name: "Custom" });
    const { api, showFormPrompt } = makeFakeApi([userPreset]);
    showFormPrompt.mockResolvedValue(null);
    await openBotTaskFlow(api);

    const fields = showFormPrompt.mock.calls[0][1] as Array<{
      key: string;
      options?: Array<{ value: string }>;
    }>;
    const presetField = fields.find((f) => f.key === "preset")!;
    const values = (presetField.options ?? []).map((o) => o.value);
    expect(values).toEqual(["Custom"]);
  });

  it("includes a task field in the form", async () => {
    const { api, showFormPrompt } = makeFakeApi([makePreset()]);
    showFormPrompt.mockResolvedValue(null);
    await openBotTaskFlow(api);

    const fields = showFormPrompt.mock.calls[0][1] as Array<{ key: string }>;
    expect(fields.map((f) => f.key)).toContain("task");
  });

  it("appends the task field as a quoted shell arg to the preset command", async () => {
    const preset = makePreset({ name: "Claude", command: "claude", env: {} });
    const { api, showFormPrompt, createWorkspaceFromDef } = makeFakeApi([
      preset,
    ]);
    showFormPrompt.mockResolvedValue({
      name: "feat/cool",
      base: "main",
      preset: "Claude",
      task: "Land the auth refactor",
    });

    await openBotTaskFlow(api);

    expect(createWorkspaceFromDef).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: expect.objectContaining({
          pane: expect.objectContaining({
            surfaces: expect.arrayContaining([
              expect.objectContaining({
                type: "terminal",
                command: "claude $'Land the auth refactor'",
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("falls back to the preset initialPrompt when no task is typed", async () => {
    const preset = makePreset({
      name: "Claude",
      command: "claude",
      env: {},
      initialPrompt: "Continue from where we left off",
    });
    const { api, showFormPrompt, createWorkspaceFromDef } = makeFakeApi([
      preset,
    ]);
    showFormPrompt.mockResolvedValue({
      name: "feat/cool",
      base: "main",
      preset: "Claude",
      task: "",
    });

    await openBotTaskFlow(api);

    expect(createWorkspaceFromDef).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: expect.objectContaining({
          pane: expect.objectContaining({
            surfaces: expect.arrayContaining([
              expect.objectContaining({
                type: "terminal",
                command: "claude $'Continue from where we left off'",
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("runs the bare preset command when neither task nor initialPrompt is set", async () => {
    const preset = makePreset({ name: "Claude", command: "claude", env: {} });
    const { api, showFormPrompt, createWorkspaceFromDef } = makeFakeApi([
      preset,
    ]);
    showFormPrompt.mockResolvedValue({
      name: "feat/cool",
      base: "main",
      preset: "Claude",
      task: "",
    });

    await openBotTaskFlow(api);

    expect(createWorkspaceFromDef).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: expect.objectContaining({
          pane: expect.objectContaining({
            surfaces: expect.arrayContaining([
              expect.objectContaining({
                type: "terminal",
                command: "claude",
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("marks the created workspace as controlled", async () => {
    const { api, showFormPrompt, createWorkspaceFromDef } = makeFakeApi([
      makePreset(),
    ]);
    showFormPrompt.mockResolvedValue({
      name: "feat/cool",
      base: "main",
      preset: "My Agent",
      task: "",
    });

    await openBotTaskFlow(api);

    expect(createWorkspaceFromDef).toHaveBeenCalledWith(
      expect.objectContaining({ controlled: true }),
    );
  });

  it("escapes single quotes and backslashes inside the task", async () => {
    const preset = makePreset({ name: "Claude", command: "claude", env: {} });
    const { api, showFormPrompt, createWorkspaceFromDef } = makeFakeApi([
      preset,
    ]);
    showFormPrompt.mockResolvedValue({
      name: "feat/cool",
      base: "main",
      preset: "Claude",
      task: "it's a \\test",
    });

    await openBotTaskFlow(api);

    const call = createWorkspaceFromDef.mock.calls[0][0] as {
      layout: { pane: { surfaces: Array<{ command?: string }> } };
    };
    expect(call.layout.pane.surfaces[0].command).toBe(
      "claude $'it\\'s a \\\\test'",
    );
  });

  it("reports error and aborts when name is empty after trim", async () => {
    const { api, showFormPrompt, invoke, createWorkspaceFromDef, reportError } =
      makeFakeApi([makePreset()]);
    showFormPrompt.mockResolvedValue({
      name: "   ",
      base: "main",
      preset: "My Agent",
      task: "",
    });

    await openBotTaskFlow(api);

    expect(reportError).toHaveBeenCalledWith("Branch name cannot be empty.");
    expect(invoke).not.toHaveBeenCalledWith(
      "create_worktree",
      expect.anything(),
    );
    expect(createWorkspaceFromDef).not.toHaveBeenCalled();
  });
});
