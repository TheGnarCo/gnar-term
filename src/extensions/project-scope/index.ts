/**
 * Project Scope — included extension
 *
 * Groups workspaces into projects. Each project registers its own
 * primary sidebar section, showing nested workspaces and contextual
 * workspace actions. Manages its own overlays (create dialog, dashboard)
 * via the overlay registry — no core store dependencies.
 */
import { writable } from "svelte/store";
import type { ExtensionManifest, ExtensionAPI } from "../api";
import ProjectsContainer from "./ProjectsContainer.svelte";
import ProjectDashboardOverlay from "./ProjectDashboardOverlay.svelte";
import ProjectCreateOverlay from "./ProjectCreateOverlay.svelte";

/**
 * Reactive store for the currently-open dashboard project ID.
 * Components subscribe to this for visibility — unlike api.state (a plain Map),
 * this triggers Svelte reactivity on change.
 */
export const dashboardProjectId$ = writable<string | null>(null);

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
  "#ff6ac1",
  "#43d08a",
  "#7aa2f7",
  "#f5a97f",
];

function generateId(): string {
  return crypto.randomUUID();
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
    events: [
      "workspace:created",
      "workspace:closed",
      "workspace:activated",
      "extension:project:dashboard-opened",
      "extension:project:dialog-toggle",
      "extension:project:state-changed",
    ],
  },
};

export function registerProjectScopeExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    // Register overlays — rendered generically by App.svelte
    api.registerOverlay("dashboard", ProjectDashboardOverlay);
    api.registerOverlay("create-dialog", ProjectCreateOverlay);

    /**
     * Project creation flow using extension-owned overlay.
     * Stores a resolve callback in state so the overlay can resolve the
     * Promise directly — no polling needed.
     */
    async function createProjectFlow(): Promise<void> {
      api.state.set("createDialogResult", null);
      api.state.set("showCreateDialog", true);
      api.emit("extension:project:dialog-toggle", { visible: true });

      const result = await new Promise<{
        name: string;
        path: string;
        color: string;
      } | null>((resolve) => {
        api.state.set("createDialogResolve", resolve);
      });

      if (!result) return;

      let isGit = false;
      try {
        isGit = await api.invoke<boolean>("is_git_repo", {
          path: result.path,
        });
      } catch {
        // Not a git repo or path doesn't exist
      }

      const id = generateId();
      const project: ProjectEntry = {
        id,
        name: result.name,
        path: result.path,
        color: result.color,
        workspaceIds: [],
        isGit,
        createdAt: new Date().toISOString(),
      };

      const projects = api.state.get<ProjectEntry[]>("projects") || [];
      projects.push(project);
      api.state.set("projects", projects);
      api.state.set("activeProjectId", id);
      api.emit("extension:project:state-changed", { projectId: id });
    }

    // Register the single "Projects" container section. All projects render
    // as sub-items inside it, with inner drag-reorder.
    api.registerPrimarySidebarSection("projects", ProjectsContainer, {
      collapsible: false,
      showLabel: false,
      label: "Projects",
      props: { onCreateProject: createProjectFlow },
    });

    // Load persisted projects. Workspace IDs are regenerated every restart
    // (they're not persisted), so clear the stale wsId list — the
    // workspace:created handler will rebuild it from each workspace's
    // metadata.projectId as workspaces are restored.
    const projects = api.state.get<ProjectEntry[]>("projects") || [];
    const cleared = projects.map((p) => ({ ...p, workspaceIds: [] }));
    api.state.set("projects", cleared);

    // Register per-project "New Workspace" commands for the command palette
    function registerProjectCommands(projects: ProjectEntry[]): void {
      for (const project of projects) {
        const cmdId = `new-ws-${project.id}`;
        api.registerCommand(
          cmdId,
          () => {
            const count =
              (api.state.get<ProjectEntry[]>("projects") ?? []).find(
                (p) => p.id === project.id,
              )?.workspaceIds.length ?? 0;
            api.createWorkspace(
              `${project.name} Workspace ${count + 1}`,
              project.path,
              { metadata: { projectId: project.id } },
            );
          },
          { title: `${project.name}: New Workspace` },
        );
      }
    }
    registerProjectCommands(projects);

    // Commands
    api.registerCommand("create-project", createProjectFlow);

    api.registerCommand("open-project-dashboard", () => {
      const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
      if (projects.length === 0) return;

      const activeId = api.state.get<string | null>("activeProjectId");
      const project = activeId
        ? projects.find((p) => p.id === activeId)
        : projects[0];
      if (!project) return;

      dashboardProjectId$.set(project.id);
    });

    // Associate new workspaces with their project (via metadata.projectId)
    api.on("workspace:created", (event) => {
      const metadata = event.metadata as Record<string, unknown> | undefined;
      const targetProjectId = metadata?.projectId as string | undefined;
      if (!targetProjectId) return;

      const workspaceId = event.id as string | undefined;
      if (!workspaceId) return;

      const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
      const updated = projects.map((p) => {
        if (p.id === targetProjectId && !p.workspaceIds.includes(workspaceId)) {
          return { ...p, workspaceIds: [...p.workspaceIds, workspaceId] };
        }
        return p;
      });
      api.state.set("projects", updated);
      api.claimWorkspace(workspaceId);
      api.emit("extension:project:state-changed", {
        projectId: targetProjectId,
      });
    });

    // Clean up closed workspaces from all projects
    api.on("workspace:closed", (event) => {
      const workspaceId = event.id as string | undefined;
      if (!workspaceId) return;

      const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
      const updated = projects.map((p) => ({
        ...p,
        workspaceIds: p.workspaceIds.filter((id) => id !== workspaceId),
      }));
      api.state.set("projects", updated);
      api.unclaimWorkspace(workspaceId);
      api.emit("extension:project:state-changed", {});
    });
  });
}
