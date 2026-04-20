/**
 * Tests for the agentic-orchestrator "new-orchestrator" workspace
 * action. Exercises both context branches (root vs project) and the
 * templated markdown write path.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    if (cmd === "file_exists") return false;
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));
vi.mock("../../../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn().mockResolvedValue({}),
  saveExtensionState: vi.fn().mockResolvedValue(undefined),
  deleteExtensionState: vi.fn().mockResolvedValue(undefined),
}));

const { configRef, saveConfigMock } = vi.hoisted(() => {
  const ref: { current: Record<string, unknown> } = { current: {} };
  return {
    configRef: ref,
    saveConfigMock: vi.fn(async (updates: Record<string, unknown>) => {
      ref.current = { ...ref.current, ...updates };
    }),
  };
});

vi.mock("../../../lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config")>();
  return {
    ...actual,
    getConfig: () => configRef.current,
    saveConfig: saveConfigMock,
  };
});

const { createWorkspaceFromDefMock, closeWorkspaceMock } = vi.hoisted(() => ({
  createWorkspaceFromDefMock: vi.fn().mockResolvedValue("ws-new"),
  closeWorkspaceMock: vi.fn(),
}));

vi.mock("../../../lib/services/workspace-service", () => ({
  createWorkspaceFromDef: createWorkspaceFromDefMock,
  closeWorkspace: closeWorkspaceMock,
}));

const { showFormPromptMock } = vi.hoisted(() => ({
  showFormPromptMock: vi.fn(),
}));

import {
  agenticOrchestratorManifest,
  registerAgenticOrchestratorExtension,
} from "..";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
  getExtensionApiById,
} from "../../../lib/services/extension-loader";
import {
  getWorkspaceActions,
  resetWorkspaceActions,
} from "../../../lib/services/workspace-action-registry";
import {
  _resetOrchestratorService,
  getOrchestrators,
  buildOrchestratorDashboardMarkdown,
} from "../orchestrator-service";
import { resetAgentDetectionForTests } from "../../../lib/services/agent-detection-service";

const ACTION_ID = "agentic-orchestrator:new-orchestrator";

async function activate() {
  registerExtension(
    agenticOrchestratorManifest,
    registerAgenticOrchestratorExtension,
  );
  await activateExtension("agentic-orchestrator");
}

beforeEach(async () => {
  configRef.current = {};
  saveConfigMock.mockClear();
  invokeMock.mockClear();
  createWorkspaceFromDefMock.mockClear();
  createWorkspaceFromDefMock.mockResolvedValue("ws-new");
  closeWorkspaceMock.mockClear();
  showFormPromptMock.mockReset();

  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    if (cmd === "file_exists") return false;
    return undefined;
  });

  await resetExtensions();
  resetWorkspaceActions();
  _resetOrchestratorService();
  resetAgentDetectionForTests();
});

function patchApi() {
  const api = getExtensionApiById("agentic-orchestrator");
  if (!api) throw new Error("extension api not registered");
  (api as unknown as Record<string, unknown>).showFormPrompt =
    showFormPromptMock;
}

describe("agentic-orchestrator new-orchestrator action: registration", () => {
  it("registers the workspace action with label/icon after activation", async () => {
    await activate();
    const action = getWorkspaceActions().find((a) => a.id === ACTION_ID);
    expect(action).toBeDefined();
    expect(action!.label).toBe("New Agent Orchestrator");
    expect(action!.icon).toBe("layout-dashboard");
  });
});

describe("agentic-orchestrator new-orchestrator action: handler", () => {
  function getHandler() {
    const action = getWorkspaceActions().find((a) => a.id === ACTION_ID);
    if (!action) throw new Error("action not registered");
    return action.handler;
  }

  it("root context: shows dialog with directory field, then creates orchestrator + Dashboard workspace + writes markdown", async () => {
    await activate();
    patchApi();

    showFormPromptMock.mockResolvedValue({
      name: "My Orch",
      baseDir: "/picked/base",
      color: "blue",
    });

    const handler = getHandler();
    await handler({});

    expect(showFormPromptMock).toHaveBeenCalledTimes(1);
    const fields = showFormPromptMock.mock.calls[0]![1] as Array<{
      key: string;
      type?: string;
    }>;
    expect(fields.map((f) => f.key)).toEqual(["baseDir", "name", "color"]);

    const orchestrators = getOrchestrators();
    expect(orchestrators).toHaveLength(1);
    const o = orchestrators[0];
    expect(o.name).toBe("My Orch");
    expect(o.baseDir).toBe("/picked/base");
    expect(o.color).toBe("blue");
    expect(o.parentProjectId).toBeUndefined();
    expect(o.dashboardWorkspaceId).toBe("ws-new");

    // createOrchestrator creates the Dashboard workspace.
    expect(createWorkspaceFromDefMock).toHaveBeenCalledTimes(1);

    // Templated md write.
    const writeCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "write_file",
    );
    expect(writeCall).toBeDefined();
    const writeArgs = writeCall![1] as { path: string; content: string };
    expect(writeArgs.path).toBe(o.path);
    expect(writeArgs.content).toBe(buildOrchestratorDashboardMarkdown(o));
    expect(writeArgs.content).toContain("# My Orch");
    expect(writeArgs.content).toContain("/picked/base");
    expect(writeArgs.content).toContain(o.id);
  });

  it("project context: only asks for name; inherits baseDir + color from the project", async () => {
    await activate();
    patchApi();

    showFormPromptMock.mockResolvedValue({ name: "Project Orch" });

    const handler = getHandler();
    await handler({
      projectId: "proj-42",
      projectPath: "/work/proj",
      projectColor: "blue",
      isGit: true,
    });

    expect(showFormPromptMock).toHaveBeenCalledTimes(1);
    const fields = showFormPromptMock.mock.calls[0]![1] as Array<{
      key: string;
    }>;
    expect(fields.map((f) => f.key)).toEqual(["name"]);

    const orchestrators = getOrchestrators();
    expect(orchestrators).toHaveLength(1);
    const o = orchestrators[0];
    expect(o.baseDir).toBe("/work/proj");
    expect(o.color).toBe("blue");
    expect(o.parentProjectId).toBe("proj-42");
    expect(o.path).toBe(`/work/proj/.gnar-term/orchestrators/${o.id}.md`);
  });

  it("aborts when form is cancelled", async () => {
    await activate();
    patchApi();

    showFormPromptMock.mockResolvedValue(null);

    const handler = getHandler();
    await handler({});

    expect(getOrchestrators()).toHaveLength(0);
  });

  it("aborts when baseDir comes back blank", async () => {
    await activate();
    patchApi();

    showFormPromptMock.mockResolvedValue({
      name: "Nameless",
      baseDir: "   ",
      color: "purple",
    });

    const handler = getHandler();
    await handler({});

    expect(getOrchestrators()).toHaveLength(0);
  });

  it("aborts when name is blank/whitespace-only", async () => {
    await activate();
    patchApi();

    showFormPromptMock.mockResolvedValue({
      name: "   ",
      baseDir: "/x",
      color: "purple",
    });

    const handler = getHandler();
    await handler({});

    expect(getOrchestrators()).toHaveLength(0);
  });

  it("does not overwrite an existing markdown file", async () => {
    await activate();
    patchApi();

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") return "/home/test";
      if (cmd === "file_exists") return true;
      return undefined;
    });

    showFormPromptMock.mockResolvedValue({
      name: "Keeper",
      baseDir: "/keep",
      color: "purple",
    });

    const handler = getHandler();
    await handler({});

    const writeCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "write_file",
    );
    expect(writeCall).toBeUndefined();
    expect(getOrchestrators()).toHaveLength(1);
  });
});
