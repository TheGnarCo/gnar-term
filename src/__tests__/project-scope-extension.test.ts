/**
 * Tests for the project-scope included extension — validates manifest,
 * registration, workspace action registration, dynamic per-project
 * sections, and event-driven workspace association.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import {
  projectScopeManifest,
  registerProjectScopeExtension,
} from "../extensions/project-scope";
import {
  sidebarSectionStore,
  resetSidebarSections,
} from "../lib/services/sidebar-section-registry";
import { commandStore, resetCommands } from "../lib/services/command-registry";
import {
  workspaceActionStore,
  resetWorkspaceActions,
} from "../lib/services/workspace-action-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
  createExtensionAPI,
} from "../lib/services/extension-loader";

describe("Project Scope included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSidebarSections();
    resetCommands();
    resetWorkspaceActions();
  });

  it("manifest has correct id, name, and included flag", () => {
    expect(projectScopeManifest.id).toBe("project-scope");
    expect(projectScopeManifest.name).toBe("Project Scope");
    expect(projectScopeManifest.version).toBe("0.1.0");
    expect(projectScopeManifest.included).toBe(true);
  });

  it("manifest declares workspace actions", () => {
    const actions = projectScopeManifest.contributes?.workspaceActions;
    expect(actions).toHaveLength(1);
    expect(actions![0].id).toBe("create-project");
    expect(actions![0].title).toBe("New Project");
  });

  it("manifest does not declare primarySidebarSections", () => {
    // Sections are now registered dynamically per project, not statically
    expect(
      projectScopeManifest.contributes?.primarySidebarSections,
    ).toBeUndefined();
  });

  it("manifest declares commands", () => {
    const commands = projectScopeManifest.contributes?.commands;
    expect(commands).toHaveLength(2);
    expect(commands!.find((c) => c.id === "create-project")).toBeTruthy();
    expect(
      commands!.find((c) => c.id === "open-project-dashboard"),
    ).toBeTruthy();
  });

  it("manifest declares workspace events", () => {
    const events = projectScopeManifest.contributes?.events;
    expect(events).toContain("workspace:created");
    expect(events).toContain("workspace:closed");
    expect(events).toContain("workspace:activated");
  });

  it("registers workspace action via API", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const actions = get(workspaceActionStore);
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("project-scope:create-project");
    expect(actions[0].label).toBe("New Project");
    expect(actions[0].icon).toBe("folder-plus");
  });

  it("workspace action when filter hides in project context", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const actions = get(workspaceActionStore);
    const createAction = actions[0];
    expect(createAction.when).toBeDefined();
    // Should be visible when not in a project context
    expect(createAction.when!({ projectId: undefined })).toBe(true);
    expect(createAction.when!({})).toBe(true);
    // Should be hidden when inside a project context
    expect(createAction.when!({ projectId: "some-project" })).toBe(false);
  });

  it("registers no sidebar sections when no projects exist", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const sections = get(sidebarSectionStore);
    expect(sections).toHaveLength(0);
  });

  it("registers sidebar sections for persisted projects on activate", async () => {
    const { api } = createExtensionAPI(projectScopeManifest);
    // Pre-populate state with projects before activation
    api.state.set("projects", [
      {
        id: "proj-1",
        name: "Alpha",
        path: "/tmp/alpha",
        color: "#e06c75",
        workspaceIds: [],
        isGit: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "proj-2",
        name: "Beta",
        path: "/tmp/beta",
        color: "#98c379",
        workspaceIds: [],
        isGit: true,
        createdAt: new Date().toISOString(),
      },
    ]);

    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");

    const sections = get(sidebarSectionStore);
    expect(sections).toHaveLength(2);
    expect(sections[0].id).toBe("project-scope:project-proj-1");
    expect(sections[0].label).toBe("Alpha");
    expect(sections[0].props).toEqual({ projectId: "proj-1" });
    expect(sections[1].id).toBe("project-scope:project-proj-2");
    expect(sections[1].label).toBe("Beta");
    expect(sections[1].props).toEqual({ projectId: "proj-2" });
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
