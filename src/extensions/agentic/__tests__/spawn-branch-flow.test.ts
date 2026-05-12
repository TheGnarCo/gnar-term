import { describe, it, expect, vi, beforeEach } from "vitest";
import { writable } from "svelte/store";
import type { ExtensionAPI, AgentPresetRef, WorkspaceRef } from "../../api";

// Import after defining mocks (hoisted by vitest)
import { openSpawnBranchFlow } from "../header/spawn-branch-flow";

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
  const showFormPrompt = vi
    .fn()
    .mockResolvedValue({ name: "feat/cool", base: "main", preset: "My Agent" });
  const invoke = vi.fn().mockResolvedValue(undefined);
  const createWorkspaceFromDef = vi.fn().mockResolvedValue("ws-new");
  const reportError = vi.fn();

  const api = {
    agentPresets,
    activeWorkspace,
    getActiveCwd,
    showFormPrompt,
    invoke,
    createWorkspaceFromDef,
    reportError,
  } as unknown as ExtensionAPI;

  return {
    api,
    activeWorkspace,
    getActiveCwd,
    showFormPrompt,
    invoke,
    createWorkspaceFromDef,
    reportError,
  };
}

function makeFakeApiNoCwd(presets: AgentPresetRef[] = []) {
  const agentPresets = writable<AgentPresetRef[]>(presets);
  const activeWorkspace = writable<WorkspaceRef | null>(null);
  const getActiveCwd = vi
    .fn()
    .mockResolvedValue(undefined as string | undefined);
  const showFormPrompt = vi.fn().mockResolvedValue(null);
  const invoke = vi.fn().mockResolvedValue(undefined);
  const createWorkspaceFromDef = vi.fn().mockResolvedValue("ws-new");
  const reportError = vi.fn();

  const api = {
    agentPresets,
    activeWorkspace,
    getActiveCwd,
    showFormPrompt,
    invoke,
    createWorkspaceFromDef,
    reportError,
  } as unknown as ExtensionAPI;

  return {
    api,
    getActiveCwd,
    showFormPrompt,
    invoke,
    createWorkspaceFromDef,
    reportError,
  };
}

describe("openSpawnBranchFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls reportError and returns early when getActiveCwd returns undefined", async () => {
    const { api, invoke, createWorkspaceFromDef, reportError } =
      makeFakeApiNoCwd([]);
    await openSpawnBranchFlow(api);
    expect(reportError).toHaveBeenCalledWith(
      expect.stringContaining("no active workspace cwd"),
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(createWorkspaceFromDef).not.toHaveBeenCalled();
  });

  it("returns early without invoke/createWorkspaceFromDef when user cancels the form", async () => {
    const { api, showFormPrompt, invoke, createWorkspaceFromDef } = makeFakeApi(
      [makePreset()],
    );
    showFormPrompt.mockResolvedValue(null);
    await openSpawnBranchFlow(api);
    expect(invoke).not.toHaveBeenCalled();
    expect(createWorkspaceFromDef).not.toHaveBeenCalled();
  });

  it("calls invoke(create_worktree) then createWorkspaceFromDef with preset command/env on valid form submission", async () => {
    const preset = makePreset({
      name: "My Agent",
      command: "claude",
      env: { TOKEN: "abc" },
    });
    const { api, invoke, createWorkspaceFromDef } = makeFakeApi([preset]);

    await openSpawnBranchFlow(api);

    // invoke create_worktree called with right args
    expect(invoke).toHaveBeenCalledWith("create_worktree", {
      repoPath: "/home/user/my-repo",
      branch: "feat/cool",
      base: "main",
      worktreePath: "/home/user/my-repo-feat-cool",
    });

    // createWorkspaceFromDef called with the preset command/env on the surface
    expect(createWorkspaceFromDef).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "feat/cool",
        cwd: "/home/user/my-repo-feat-cool",
        layout: expect.objectContaining({
          pane: expect.objectContaining({
            surfaces: expect.arrayContaining([
              expect.objectContaining({
                type: "terminal",
                command: "claude",
                env: { TOKEN: "abc" },
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("shows info field instead of preset select when presets list is empty", async () => {
    const { api, showFormPrompt } = makeFakeApi([]);
    // form cancelled to avoid going further
    showFormPrompt.mockResolvedValue(null);
    await openSpawnBranchFlow(api);

    const fields = showFormPrompt.mock.calls[0][1] as Array<{
      key: string;
      type?: string;
    }>;
    const keys = fields.map((f) => f.key);
    // should NOT have a "preset" select field
    expect(keys).not.toContain("preset");
    // should have an info field
    const infoField = fields.find((f) => f.type === "info");
    expect(infoField).toBeDefined();
    // should still have name + base
    expect(keys).toContain("name");
    expect(keys).toContain("base");
  });

  it("includes a preset select field when presets are available", async () => {
    const { api, showFormPrompt } = makeFakeApi([makePreset()]);
    showFormPrompt.mockResolvedValue(null);
    await openSpawnBranchFlow(api);

    const fields = showFormPrompt.mock.calls[0][1] as Array<{
      key: string;
      type?: string;
    }>;
    const presetField = fields.find((f) => f.key === "preset");
    expect(presetField).toBeDefined();
    expect(presetField!.type).toBe("select");
    // no info field
    expect(fields.find((f) => f.type === "info")).toBeUndefined();
  });

  it("calls reportError and does not invoke when name is empty after trim", async () => {
    const { api, showFormPrompt, invoke, createWorkspaceFromDef, reportError } =
      makeFakeApi([makePreset()]);
    showFormPrompt.mockResolvedValue({
      name: "   ",
      base: "main",
      preset: "My Agent",
    });
    await openSpawnBranchFlow(api);
    expect(reportError).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(createWorkspaceFromDef).not.toHaveBeenCalled();
  });

  it("forwards activeWorkspace.id as rootWorkspaceId so the spawn becomes a Branch", async () => {
    const activeWs = {
      id: "ws-active-42",
      name: "active",
    } as unknown as WorkspaceRef;
    const { api, createWorkspaceFromDef } = makeFakeApi(
      [makePreset()],
      "/home/user/my-repo",
      activeWs,
    );

    await openSpawnBranchFlow(api);

    expect(createWorkspaceFromDef).toHaveBeenCalledWith(
      expect.objectContaining({ rootWorkspaceId: "ws-active-42" }),
    );
  });

  it("omits rootWorkspaceId when no active workspace is available", async () => {
    const { api, createWorkspaceFromDef } = makeFakeApi(
      [makePreset()],
      "/home/user/my-repo",
      null,
    );

    await openSpawnBranchFlow(api);

    const call = createWorkspaceFromDef.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(call).not.toHaveProperty("rootWorkspaceId");
  });

  it("calls reportError and skips createWorkspaceFromDef when invoke throws", async () => {
    const { api, invoke, createWorkspaceFromDef, reportError } = makeFakeApi([
      makePreset(),
    ]);
    invoke.mockRejectedValue(new Error("worktree failed"));
    await openSpawnBranchFlow(api);
    expect(reportError).toHaveBeenCalledWith(
      expect.stringContaining("worktree failed"),
    );
    expect(createWorkspaceFromDef).not.toHaveBeenCalled();
  });
});
