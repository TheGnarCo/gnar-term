/**
 * Project Scope — included extension
 *
 * Groups workspaces into projects. Each project appears as a collapsible
 * item in a primary sidebar section showing its nested workspaces.
 */
import type {
  ExtensionManifest,
  ExtensionAPI,
} from "../../lib/extension-types";
import ProjectSection from "./ProjectSection.svelte";

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  color: string;
  workspaceIds: string[];
  isGit: boolean;
  createdAt: string;
}

export const PROJECT_COLORS = [
  "#e06c75",
  "#98c379",
  "#e5c07b",
  "#61afef",
  "#c678dd",
  "#56b6c2",
  "#d19a66",
  "#be5046",
];

function randomColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
}

/**
 * Prompt the user for project details and create a new ProjectEntry.
 * Shared by the command handler and the sidebar component button.
 */
export async function createProjectViaPrompt(api: ExtensionAPI): Promise<void> {
  const name = await api.showInputPrompt("Project name");
  if (!name) return;

  const path = await api.showInputPrompt("Project path (directory)");
  if (!path) return;

  let isGit = false;
  try {
    isGit = await api.invoke<boolean>("is_git_repo", { path });
  } catch {
    // Not a git repo or path doesn't exist — that's fine
  }

  const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
  const entry: ProjectEntry = {
    id: crypto.randomUUID(),
    name,
    path,
    color: randomColor(),
    workspaceIds: [],
    isGit,
    createdAt: new Date().toISOString(),
  };

  api.state.set("projects", [...projects, entry]);
  api.state.set("activeProjectId", entry.id);
}

export const projectScopeManifest: ExtensionManifest = {
  id: "project-scope",
  name: "Project Scope",
  version: "0.1.0",
  description: "Group workspaces into projects",
  entry: "./index.ts",
  included: true,
  contributes: {
    primarySidebarSections: [{ id: "projects", label: "Projects" }],
    commands: [
      { id: "create-project", title: "Create Project..." },
      { id: "open-project-dashboard", title: "Open Project Dashboard..." },
    ],
    events: ["workspace:created", "workspace:closed", "workspace:activated"],
  },
};

export function registerProjectScopeExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerPrimarySidebarSection("projects", ProjectSection, {
      collapsible: true,
      showLabel: true,
    });

    api.registerCommand("create-project", () => createProjectViaPrompt(api));

    api.registerCommand("open-project-dashboard", async () => {
      const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
      if (projects.length === 0) return;

      const activeId = api.state.get<string | null>("activeProjectId");
      const project = activeId
        ? projects.find((p) => p.id === activeId)
        : projects[0];
      if (!project) return;

      api.openSurface("dashboard:dashboard", project.name, {
        projectId: project.id,
      });
    });

    api.on("workspace:created", (event) => {
      const activeProjectId = api.state.get<string | null>("activeProjectId");
      if (!activeProjectId) return;

      const workspaceId = event.workspaceId as string | undefined;
      if (!workspaceId) return;

      const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
      const updated = projects.map((p) => {
        if (p.id === activeProjectId && !p.workspaceIds.includes(workspaceId)) {
          return { ...p, workspaceIds: [...p.workspaceIds, workspaceId] };
        }
        return p;
      });
      api.state.set("projects", updated);
    });

    api.on("workspace:closed", (event) => {
      const workspaceId = event.workspaceId as string | undefined;
      if (!workspaceId) return;

      const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
      const updated = projects.map((p) => ({
        ...p,
        workspaceIds: p.workspaceIds.filter((id) => id !== workspaceId),
      }));
      api.state.set("projects", updated);
    });
  });
}
