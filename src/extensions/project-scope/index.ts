/**
 * Project Scope — included extension
 *
 * Groups workspaces into projects. Each project registers its own
 * primary sidebar section, showing nested workspaces and contextual
 * workspace actions.
 */
import type {
  ExtensionManifest,
  ExtensionAPI,
} from "../../lib/extension-types";
import ProjectSectionContent from "./ProjectSectionContent.svelte";

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

function generateId(): string {
  return crypto.randomUUID();
}

function randomColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
}

/**
 * Register a primary sidebar section for a single project.
 * The section renders ProjectSectionContent with the project's ID
 * passed as a prop.
 */
function registerProjectSection(
  api: ExtensionAPI,
  project: ProjectEntry,
): void {
  api.registerPrimarySidebarSection(
    `project-${project.id}`,
    ProjectSectionContent,
    {
      collapsible: true,
      showLabel: true,
      label: project.name,
      props: { projectId: project.id },
    },
  );
}

export const projectScopeManifest: ExtensionManifest = {
  id: "project-scope",
  name: "Project Scope",
  version: "0.1.0",
  description: "Group workspaces into projects",
  entry: "./index.ts",
  included: true,
  contributes: {
    workspaceActions: [{ id: "create-project", title: "New Project" }],
    commands: [
      { id: "create-project", title: "Create Project..." },
      { id: "open-project-dashboard", title: "Open Project Dashboard..." },
    ],
    events: ["workspace:created", "workspace:closed", "workspace:activated"],
  },
};

export function registerProjectScopeExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    // Register workspace action for creating new projects
    api.registerWorkspaceAction("create-project", {
      label: "New Project",
      icon: "folder-plus",
      handler: async () => {
        const path = await api.pickDirectory("Select Project Root");
        if (!path) return;
        const name = await api.showInputPrompt("Project name");
        if (!name) return;

        let isGit = false;
        try {
          isGit = await api.invoke<boolean>("is_git_repo", { path });
        } catch {
          // Not a git repo or path doesn't exist
        }

        const id = generateId();
        const color = randomColor();
        const project: ProjectEntry = {
          id,
          name,
          path,
          color,
          workspaceIds: [],
          isGit,
          createdAt: new Date().toISOString(),
        };

        const projects = api.state.get<ProjectEntry[]>("projects") || [];
        projects.push(project);
        api.state.set("projects", projects);

        // Register the sidebar section for this new project
        registerProjectSection(api, project);
      },
      when: (ctx) => {
        // Hide inside project context — can't nest projects
        return !ctx.projectId;
      },
    });

    // Load persisted projects and register a section for each
    const projects = api.state.get<ProjectEntry[]>("projects") || [];
    for (const project of projects) {
      registerProjectSection(api, project);
    }

    // Command: create-project (command palette entry)
    api.registerCommand("create-project", async () => {
      const path = await api.pickDirectory("Select Project Root");
      if (!path) return;
      const name = await api.showInputPrompt("Project name");
      if (!name) return;

      let isGit = false;
      try {
        isGit = await api.invoke<boolean>("is_git_repo", { path });
      } catch {
        // Not a git repo
      }

      const id = generateId();
      const color = randomColor();
      const project: ProjectEntry = {
        id,
        name,
        path,
        color,
        workspaceIds: [],
        isGit,
        createdAt: new Date().toISOString(),
      };

      const projects = api.state.get<ProjectEntry[]>("projects") || [];
      projects.push(project);
      api.state.set("projects", projects);
      api.state.set("activeProjectId", id);

      registerProjectSection(api, project);
    });

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

    // Auto-associate new workspaces with the active project
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

    // Clean up closed workspaces from all projects
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
