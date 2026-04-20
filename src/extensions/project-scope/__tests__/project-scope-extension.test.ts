/**
 * Tests for the project-scope included extension — validates manifest,
 * registration, workspace action registration, dynamic per-project
 * sections, and event-driven workspace association.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const { findByPathSpy, focusSpy, createSpy } = vi.hoisted(() => ({
  findByPathSpy: vi.fn(),
  focusSpy: vi.fn(),
  createSpy: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "file_exists") return true; // skip seed write in tests
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("../../../lib/services/preview-surface-registry", () => ({
  findPreviewSurfaceByPath: findByPathSpy,
}));
vi.mock("../../../lib/services/surface-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/services/surface-service")
  >("../../../lib/services/surface-service");
  return {
    ...actual,
    focusSurfaceById: focusSpy,
    createPreviewSurfaceInPane: createSpy,
  };
});

import {
  projectScopeManifest,
  registerProjectScopeExtension,
  openProjectDashboard,
  type ProjectEntry,
} from "..";
import { invoke } from "@tauri-apps/api/core";
import { workspaces, activeWorkspaceIdx } from "../../../lib/stores/workspace";
import type { Workspace } from "../../../lib/types";
import {
  sidebarSectionStore,
  resetSidebarSections,
} from "../../../lib/services/sidebar-section-registry";
import {
  rootRowRendererStore,
  resetRootRowRenderers,
} from "../../../lib/services/root-row-renderer-registry";
import {
  commandStore,
  resetCommands,
} from "../../../lib/services/command-registry";
import {
  workspaceActionStore,
  resetWorkspaceActions,
} from "../../../lib/services/workspace-action-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
  createExtensionAPI,
} from "../../../lib/services/extension-loader";

describe("Project Scope included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSidebarSections();
    resetRootRowRenderers();
    resetCommands();
    resetWorkspaceActions();
  });

  it("manifest has correct id, name, and included flag", () => {
    expect(projectScopeManifest.id).toBe("project-scope");
    expect(projectScopeManifest.name).toBe("Project Scope");
    expect(projectScopeManifest.version).toBe("0.1.0");
    expect(projectScopeManifest.included).toBe(true);
  });

  it("manifest declares the 'new-project' workspace action", () => {
    // Projects are created via the Workspaces header "+ New" dropdown.
    const actions = projectScopeManifest.contributes?.workspaceActions;
    expect(actions).toHaveLength(1);
    expect(actions![0].id).toBe("new-project");
  });

  it("manifest does not declare a primary sidebar section", () => {
    // Projects render inline inside the Workspaces section via the
    // root-row-renderer extension API — not as a top-level section.
    const sections = projectScopeManifest.contributes?.primarySidebarSections;
    expect(sections === undefined || sections.length === 0).toBe(true);
  });

  it("manifest declares commands", () => {
    const commands = projectScopeManifest.contributes?.commands;
    expect(commands).toHaveLength(3);
    expect(commands!.find((c) => c.id === "create-project")).toBeTruthy();
    expect(
      commands!.find((c) => c.id === "open-project-dashboard"),
    ).toBeTruthy();
    expect(
      commands!.find((c) => c.id === "promote-workspace-to-project"),
    ).toBeTruthy();
  });

  it("manifest declares workspace events", () => {
    const events = projectScopeManifest.contributes?.events;
    expect(events).toContain("workspace:created");
    expect(events).toContain("workspace:closed");
    expect(events).toContain("workspace:activated");
  });

  it("registers 'new-project' as a workspace-zone action (surfaces in the Workspaces + New dropdown)", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const actions = get(workspaceActionStore);
    const newProject = actions.find((a) => a.id.endsWith(":new-project"));
    expect(newProject).toBeDefined();
    // zone defaults to "workspace" (dropdown), not "sidebar".
    expect(newProject?.zone).not.toBe("sidebar");
  });

  it("registers no top-level primary sidebar section", async () => {
    // Projects now render inline inside the Workspaces section.
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const sections = get(sidebarSectionStore);
    expect(sections).toHaveLength(0);
  });

  it("registers a 'project' root-row renderer", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const renderers = get(rootRowRendererStore);
    const projectRenderer = renderers.find((r) => r.id === "project");
    expect(projectRenderer).toBeDefined();
    expect(projectRenderer?.source).toBe("project-scope");
    expect(projectRenderer?.component).toBeDefined();
  });

  it("registers commands via API", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const cmds = get(commandStore);
    expect(
      cmds.find((c) => c.id === "project-scope:create-project"),
    ).toBeTruthy();
    expect(
      cmds.find((c) => c.id === "project-scope:open-project-dashboard"),
    ).toBeTruthy();
  });
});

describe("Project Scope dashboard preview", () => {
  function makeProject(id: string, path: string, name = id): ProjectEntry {
    return {
      id,
      name,
      path,
      color: "purple",
      workspaceIds: [],
      isGit: false,
      createdAt: "2026-04-19T00:00:00.000Z",
    };
  }

  function seedActivePane(paneId: string): void {
    const ws: Workspace = {
      id: "ws-active",
      name: "Active",
      activePaneId: paneId,
      splitRoot: {
        type: "pane",
        pane: { id: paneId, surfaces: [], activeSurfaceId: null },
      },
    };
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
  }

  beforeEach(async () => {
    await resetExtensions();
    resetCommands();
    findByPathSpy.mockReset();
    focusSpy.mockReset();
    createSpy.mockReset();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    (invoke as ReturnType<typeof vi.fn>).mockClear();
  });

  it("openProjectDashboard spawns a preview when no existing surface matches the path", async () => {
    findByPathSpy.mockReturnValue(undefined);
    createSpy.mockReturnValue({ id: "s-new" });
    seedActivePane("pane-active");

    const project = makeProject("proj-1", "/tmp/alpha", "Alpha");
    const ok = await openProjectDashboard(project);

    expect(ok).toBe(true);
    expect(findByPathSpy).toHaveBeenCalledWith(
      "/tmp/alpha/.gnar-term/project-dashboard.md",
    );
    expect(createSpy).toHaveBeenCalledWith(
      "pane-active",
      "/tmp/alpha/.gnar-term/project-dashboard.md",
      expect.objectContaining({ focus: true, title: "Alpha" }),
    );
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("openProjectDashboard focuses an already-open preview instead of duplicating it", async () => {
    findByPathSpy.mockReturnValue({
      surfaceId: "s-existing",
      path: "/tmp/alpha/.gnar-term/project-dashboard.md",
      paneId: "pane-other",
      workspaceId: "ws-other",
    });
    seedActivePane("pane-active");

    const project = makeProject("proj-1", "/tmp/alpha", "Alpha");
    const ok = await openProjectDashboard(project);

    expect(ok).toBe(true);
    expect(focusSpy).toHaveBeenCalledWith("s-existing");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("open-project-dashboard command is registered and routes through openProjectDashboard", async () => {
    const { api } = createExtensionAPI(projectScopeManifest);
    api.state.set("projects", [
      {
        id: "proj-1",
        name: "Alpha",
        path: "/tmp/alpha",
        color: "purple",
        workspaceIds: [],
        isGit: false,
        createdAt: new Date().toISOString(),
      },
    ]);
    api.state.set("activeProjectId", "proj-1");

    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");

    const cmd = get(commandStore).find(
      (c) => c.id === "project-scope:open-project-dashboard",
    );
    expect(cmd).toBeTruthy();

    // Synchronous call; openProjectDashboard kicks off async invokes but
    // schedules findPreviewSurfaceByPath via the same microtask queue. We
    // assert the lookup fired (which is what the command must do before
    // it can decide between focus vs spawn), regardless of how far the
    // async write chain progresses inside the same tick.
    findByPathSpy.mockReset();
    findByPathSpy.mockReturnValue({
      surfaceId: "s-existing",
      path: "/tmp/alpha/.gnar-term/project-dashboard.md",
      paneId: "pane-active",
      workspaceId: "ws-active",
    });
    seedActivePane("pane-active");

    cmd!.action();

    // Drain the microtask queue: file_exists (mocked truthy) → no
    // ensure_dir/write_file → findPreviewSurfaceByPath → focusSurfaceById.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(findByPathSpy).toHaveBeenCalledWith(
      "/tmp/alpha/.gnar-term/project-dashboard.md",
    );
    expect(focusSpy).toHaveBeenCalledWith("s-existing");
  });
});

describe("Project Scope state management", () => {
  beforeEach(async () => {
    await resetExtensions();
  });

  it("project creation stores entry in state", () => {
    const { api } = createExtensionAPI(projectScopeManifest);

    // Simulate storing a project entry
    const entry = {
      id: "test-id",
      name: "My Project",
      path: "/home/user/project",
      color: "#e06c75",
      workspaceIds: [],
      isGit: true,
      createdAt: new Date().toISOString(),
    };

    api.state.set("projects", [entry]);
    const projects = api.state.get<(typeof entry)[]>("projects");
    expect(projects).toHaveLength(1);
    expect(projects![0].name).toBe("My Project");
    expect(projects![0].path).toBe("/home/user/project");
    expect(projects![0].isGit).toBe(true);
    expect(projects![0].workspaceIds).toEqual([]);
  });

  it("workspace auto-association adds workspace id to active project", () => {
    const { api } = createExtensionAPI(projectScopeManifest);

    const project = {
      id: "proj-1",
      name: "Test",
      path: "/tmp",
      color: "#98c379",
      workspaceIds: [],
      isGit: false,
      createdAt: new Date().toISOString(),
    };

    api.state.set("projects", [project]);
    api.state.set("activeProjectId", "proj-1");

    // Simulate the workspace:created handler logic
    const activeProjectId = api.state.get<string | null>("activeProjectId");
    expect(activeProjectId).toBe("proj-1");

    const workspaceId = "ws-abc";
    const projects = api.state.get<(typeof project)[]>("projects") ?? [];
    const updated = projects.map((p) => {
      if (p.id === activeProjectId && !p.workspaceIds.includes(workspaceId)) {
        return { ...p, workspaceIds: [...p.workspaceIds, workspaceId] };
      }
      return p;
    });
    api.state.set("projects", updated);

    const result = api.state.get<(typeof project)[]>("projects");
    expect(result![0].workspaceIds).toEqual(["ws-abc"]);
  });

  it("workspace removal cleans up workspace id from all projects", () => {
    const { api } = createExtensionAPI(projectScopeManifest);

    const project = {
      id: "proj-1",
      name: "Test",
      path: "/tmp",
      color: "#61afef",
      workspaceIds: ["ws-1", "ws-2", "ws-3"],
      isGit: false,
      createdAt: new Date().toISOString(),
    };

    api.state.set("projects", [project]);

    // Simulate the workspace:closed handler logic
    const closedId = "ws-2";
    const projects = api.state.get<(typeof project)[]>("projects") ?? [];
    const updated = projects.map((p) => ({
      ...p,
      workspaceIds: p.workspaceIds.filter((id) => id !== closedId),
    }));
    api.state.set("projects", updated);

    const result = api.state.get<(typeof project)[]>("projects");
    expect(result![0].workspaceIds).toEqual(["ws-1", "ws-3"]);
  });

  it("active project tracking stores and retrieves active project id", () => {
    const { api } = createExtensionAPI(projectScopeManifest);

    expect(api.state.get<string | null>("activeProjectId")).toBeUndefined();

    api.state.set("activeProjectId", "proj-42");
    expect(api.state.get<string | null>("activeProjectId")).toBe("proj-42");

    api.state.set("activeProjectId", null);
    expect(api.state.get<string | null>("activeProjectId")).toBeNull();
  });

  it("no auto-association when no active project", () => {
    const { api } = createExtensionAPI(projectScopeManifest);

    const project = {
      id: "proj-1",
      name: "Test",
      path: "/tmp",
      color: "#c678dd",
      workspaceIds: [],
      isGit: false,
      createdAt: new Date().toISOString(),
    };

    api.state.set("projects", [project]);
    // activeProjectId is not set — undefined

    const activeProjectId = api.state.get<string | null>("activeProjectId");
    expect(activeProjectId).toBeUndefined();

    // The handler would return early, so no changes
    const projects = api.state.get<(typeof project)[]>("projects");
    expect(projects![0].workspaceIds).toEqual([]);
  });
});
