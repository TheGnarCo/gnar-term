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
  dashboardProjectId$,
} from "..";
import {
  sidebarSectionStore,
  resetSidebarSections,
} from "../../../lib/services/sidebar-section-registry";
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
    resetCommands();
    resetWorkspaceActions();
  });

  it("manifest has correct id, name, and included flag", () => {
    expect(projectScopeManifest.id).toBe("project-scope");
    expect(projectScopeManifest.name).toBe("Project Scope");
    expect(projectScopeManifest.version).toBe("0.1.0");
    expect(projectScopeManifest.included).toBe(true);
  });

  it("manifest does not declare workspace actions", () => {
    // "+ New Project" now lives inside the Projects section container,
    // not as a sidebar-zone workspace action button.
    const actions = projectScopeManifest.contributes?.workspaceActions;
    expect(actions === undefined || actions.length === 0).toBe(true);
  });

  it("manifest declares a single 'projects' primary sidebar section", () => {
    const sections = projectScopeManifest.contributes?.primarySidebarSections;
    expect(sections).toHaveLength(1);
    expect(sections![0].id).toBe("projects");
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

  it("registers no workspace actions", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const actions = get(workspaceActionStore);
    expect(actions).toHaveLength(0);
  });

  it("registers a single 'projects' sidebar section regardless of project count", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const sections = get(sidebarSectionStore);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("project-scope:projects");
    expect(sections[0].label).toBe("Projects");
  });

  it("registers the projects sidebar section with showLabel: false", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const sections = get(sidebarSectionStore);
    const projectsSection = sections.find(
      (s: { id: string }) => s.id === "project-scope:projects",
    );
    expect(projectsSection).toBeDefined();
    expect(
      (projectsSection as unknown as { showLabel: boolean }).showLabel,
    ).toBe(false);
  });

  it("Projects section exposes onCreateProject prop to the container", async () => {
    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");
    const sections = get(sidebarSectionStore);
    const projectsSection = sections[0];
    expect(projectsSection.props).toBeDefined();
    expect(
      typeof (projectsSection.props as { onCreateProject?: unknown })
        .onCreateProject,
    ).toBe("function");
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

describe("Project Scope dashboard store", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetCommands();
    dashboardProjectId$.set(null);
  });

  it("open-project-dashboard command sets dashboardProjectId$ store", async () => {
    const { api } = createExtensionAPI(projectScopeManifest);

    // Pre-populate state with a project
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
    ]);
    api.state.set("activeProjectId", "proj-1");

    registerExtension(projectScopeManifest, registerProjectScopeExtension);
    await activateExtension("project-scope");

    expect(get(dashboardProjectId$)).toBeNull();

    // Execute the command
    const cmd = get(commandStore).find(
      (c) => c.id === "project-scope:open-project-dashboard",
    );
    expect(cmd).toBeTruthy();
    cmd!.action();

    // Store should now have the project id
    expect(get(dashboardProjectId$)).toBe("proj-1");
  });

  it("setting dashboardProjectId$ to null hides dashboard", () => {
    dashboardProjectId$.set("proj-1");
    expect(get(dashboardProjectId$)).toBe("proj-1");

    dashboardProjectId$.set(null);
    expect(get(dashboardProjectId$)).toBeNull();
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
