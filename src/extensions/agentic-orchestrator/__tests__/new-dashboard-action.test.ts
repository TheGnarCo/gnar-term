/**
 * Tests for the agentic-orchestrator "new-dashboard" workspace action.
 * Exercises both context branches (root vs project), the templated
 * markdown write path, and the openDashboard hand-off after creation.
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

const { openDashboardMock, pickDirectoryMock, showFormPromptMock } = vi.hoisted(
  () => ({
    openDashboardMock: vi.fn(() => true),
    pickDirectoryMock: vi.fn(),
    showFormPromptMock: vi.fn(),
  }),
);

vi.mock("../dashboard-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dashboard-service")>();
  return {
    ...actual,
    openDashboard: openDashboardMock,
  };
});

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
  _resetDashboardService,
  getDashboards,
  buildDashboardMarkdown,
} from "../dashboard-service";
import { resetRegistry } from "../agent-registry";

const ACTION_ID = "agentic-orchestrator:new-dashboard";

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
  openDashboardMock.mockClear();
  pickDirectoryMock.mockReset();
  showFormPromptMock.mockReset();

  // Re-stub Tauri invoke default behavior — earlier mockClear wipes
  // implementations, leaving the spy returning undefined for everything.
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    if (cmd === "file_exists") return false;
    return undefined;
  });

  await resetExtensions();
  resetWorkspaceActions();
  _resetDashboardService();
  resetRegistry();

  // The action handler reads pickDirectory / showFormPrompt off the
  // ExtensionAPI instance handed to the extension. We stub them after
  // activation so the registered handler sees our mocks at call-time.
});

function patchApi() {
  const api = getExtensionApiById("agentic-orchestrator");
  if (!api) throw new Error("extension api not registered");
  (api as unknown as Record<string, unknown>).pickDirectory = pickDirectoryMock;
  (api as unknown as Record<string, unknown>).showFormPrompt =
    showFormPromptMock;
}

describe("agentic-orchestrator new-dashboard action: registration", () => {
  it("registers the workspace action with label/icon after activation", async () => {
    await activate();
    const action = getWorkspaceActions().find((a) => a.id === ACTION_ID);
    expect(action).toBeDefined();
    expect(action!.label).toBe("New Agent Dashboard");
    expect(action!.icon).toBe("layout-dashboard");
  });
});

describe("agentic-orchestrator new-dashboard action: handler", () => {
  function getHandler() {
    const action = getWorkspaceActions().find((a) => a.id === ACTION_ID);
    if (!action) throw new Error("action not registered");
    return action.handler;
  }

  it("root context: shows dialog with directory field, then creates + writes + opens", async () => {
    await activate();
    patchApi();

    showFormPromptMock.mockResolvedValue({
      name: "My Dash",
      baseDir: "/picked/base",
      color: "blue",
    });

    const handler = getHandler();
    await handler({});

    expect(pickDirectoryMock).not.toHaveBeenCalled();
    expect(showFormPromptMock).toHaveBeenCalledTimes(1);
    const fields = showFormPromptMock.mock.calls[0]![1] as Array<{
      key: string;
      type?: string;
      defaultValue?: string;
      required?: boolean;
    }>;
    expect(fields.map((f) => f.key)).toEqual(["baseDir", "name", "color"]);
    const dirField = fields.find((f) => f.key === "baseDir") as
      | { type: string; required: boolean; defaultValue: string }
      | undefined;
    expect(dirField?.type).toBe("directory");
    expect(dirField?.required).toBe(true);
    expect(dirField?.defaultValue).toBe("");

    const dashboards = getDashboards();
    expect(dashboards).toHaveLength(1);
    const d = dashboards[0];
    expect(d.name).toBe("My Dash");
    expect(d.baseDir).toBe("/picked/base");
    expect(d.color).toBe("blue");
    expect(d.parentProjectId).toBeUndefined();

    // Templated md write — ensure_dir for parent, then write_file.
    const writeCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "write_file",
    );
    expect(writeCall).toBeDefined();
    const writeArgs = writeCall![1] as { path: string; content: string };
    expect(writeArgs.path).toBe(d.path);
    expect(writeArgs.content).toBe(buildDashboardMarkdown(d));
    expect(writeArgs.content).toContain("# My Dash");
    expect(writeArgs.content).toContain("/picked/base");
    expect(writeArgs.content).toContain(d.id);

    const ensureCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "ensure_dir",
    );
    expect(ensureCall).toBeDefined();
    expect((ensureCall![1] as { path: string }).path).toBe(
      d.path.replace(/\/[^/]+$/, ""),
    );

    expect(openDashboardMock).toHaveBeenCalledTimes(1);
    expect(openDashboardMock).toHaveBeenCalledWith(d);
  });

  it("project context: only asks for name; inherits baseDir + color from the project", async () => {
    await activate();
    patchApi();

    // Only returns the name — baseDir/color never appear in the dialog
    // because the flow inherits them from ctx.
    showFormPromptMock.mockResolvedValue({ name: "Project Dash" });

    const handler = getHandler();
    await handler({
      projectId: "proj-42",
      projectPath: "/work/proj",
      projectColor: "blue",
      isGit: true,
    });

    expect(pickDirectoryMock).not.toHaveBeenCalled();
    expect(showFormPromptMock).toHaveBeenCalledTimes(1);
    const fields = showFormPromptMock.mock.calls[0]![1] as Array<{
      key: string;
    }>;
    expect(fields.map((f) => f.key)).toEqual(["name"]);

    const dashboards = getDashboards();
    expect(dashboards).toHaveLength(1);
    const d = dashboards[0];
    expect(d.baseDir).toBe("/work/proj");
    expect(d.color).toBe("blue");
    expect(d.parentProjectId).toBe("proj-42");
    expect(d.path).toBe(`/work/proj/.gnar-term/dashboards/${d.id}.md`);

    expect(openDashboardMock).toHaveBeenCalledWith(d);
  });

  it("aborts when form is cancelled", async () => {
    await activate();
    patchApi();

    showFormPromptMock.mockResolvedValue(null);

    const handler = getHandler();
    await handler({});

    expect(getDashboards()).toHaveLength(0);
    expect(openDashboardMock).not.toHaveBeenCalled();
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

    expect(getDashboards()).toHaveLength(0);
    expect(openDashboardMock).not.toHaveBeenCalled();
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

    expect(getDashboards()).toHaveLength(0);
    expect(openDashboardMock).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing markdown file but still opens it", async () => {
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

    const dashboards = getDashboards();
    expect(dashboards).toHaveLength(1);
    expect(openDashboardMock).toHaveBeenCalledWith(dashboards[0]);
  });
});
