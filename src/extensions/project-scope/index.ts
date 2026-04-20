/**
 * Project Scope — included extension
 *
 * Groups workspaces into projects. Each project registers its own
 * primary sidebar section, showing nested workspaces and contextual
 * workspace actions. Manages its own overlays (create dialog) via the
 * overlay registry — no core store dependencies.
 *
 * Project dashboards now render as PreviewSurfaces backed by a templated
 * markdown file at `<projectPath>/.gnar-term/project-dashboard.md`,
 * mirroring the AgentDashboard preview pattern (P9).
 */
import { invoke } from "@tauri-apps/api/core";
import type { ExtensionManifest, ExtensionAPI, AppEvent } from "../api";
import { resolveProjectColor } from "../api";
import { get } from "svelte/store";
import ProjectRowBody from "./ProjectRowBody.svelte";
import ProjectCreateOverlay from "./ProjectCreateOverlay.svelte";
import {
  createPreviewSurfaceInPane,
  focusSurfaceById,
} from "../../lib/services/surface-service";
import { findPreviewSurfaceByPath } from "../../lib/services/preview-surface-registry";
import {
  activePane,
  workspaces,
  activeWorkspaceIdx,
} from "../../lib/stores/workspace";
import { getAllPanes, getAllSurfaces, isPreviewSurface } from "../../lib/types";
import {
  getProjects,
  addProject,
  addWorkspaceToProject,
  removeWorkspaceFromAllProjects,
  clearWorkspaceIds,
} from "./project-service";

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  color: string;
  workspaceIds: string[];
  isGit: boolean;
  createdAt: string;
}

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Path of the markdown file backing a project's dashboard. Lives inside
 * the project's own `.gnar-term/` directory so multi-machine sync /
 * checkout follows the project itself.
 */
export function projectDashboardPath(projectPath: string): string {
  return `${projectPath.replace(/\/+$/, "")}/.gnar-term/project-dashboard.md`;
}

/**
 * Templated markdown for a freshly-created project dashboard. Embeds
 * the gnar:agent-list widget without a `dashboardId` so it shows every
 * agent in the registry (the project's own scope is implicit through
 * the surface's location).
 */
function buildProjectDashboardMarkdown(project: ProjectEntry): string {
  return `# ${project.name}

Project at \`${project.path}\`.

## Active Agents

\`\`\`gnar:agent-list
\`\`\`
`;
}

/**
 * Idempotent — write the templated project-dashboard markdown only when
 * the file is missing. User edits survive a re-open.
 */
async function writeProjectDashboardTemplate(
  project: ProjectEntry,
  path: string,
): Promise<void> {
  const exists = await invoke<boolean>("file_exists", { path }).catch(
    () => false,
  );
  if (exists) return;
  const dir = path.replace(/\/[^/]+$/, "");
  await invoke("ensure_dir", { path: dir });
  await invoke("write_file", {
    path,
    content: buildProjectDashboardMarkdown(project),
  });
}

/**
 * Open a project's markdown dashboard as a PreviewSurface. Target
 * resolution, in order:
 *
 *   1. An existing preview surface at the dashboard path — focus it
 *      wherever it lives (focusSurfaceById switches workspaces too).
 *   2. The first workspace claimed by this project that already has a
 *      preview at the dashboard path (belt-and-suspenders for cases
 *      where the global registry missed it, e.g. pre-hydration races).
 *   3. The first workspace claimed by this project — switch to it and
 *      spawn the preview in its active pane. This is the "no dashboard
 *      open anywhere yet" path.
 *   4. No project workspaces exist — fall back to the global active
 *      pane (preserves old behavior for projects with zero workspaces).
 *
 * Returns true on success.
 */
export async function openProjectDashboard(
  project: ProjectEntry,
): Promise<boolean> {
  const path = projectDashboardPath(project.path);
  try {
    await writeProjectDashboardTemplate(project, path);
  } catch {
    // Best-effort write — proceed to open even if the seed fails so the
    // user still sees something they can react to.
  }
  // (1) Registry hit — focus it wherever it is.
  const existing = findPreviewSurfaceByPath(path);
  if (existing) {
    focusSurfaceById(existing.surfaceId);
    return true;
  }

  // (2) Fallback: any project workspace already hosting the preview.
  const wsList = get(workspaces);
  const projectWorkspaces: Array<{
    idx: number;
    ws: import("../../lib/types").Workspace;
  }> = [];
  for (const id of project.workspaceIds) {
    const idx = wsList.findIndex((w) => w.id === id);
    if (idx < 0) continue;
    const ws = wsList[idx];
    if (!ws) continue;
    projectWorkspaces.push({ idx, ws });
  }
  const target = projectWorkspaces.find((e) =>
    getAllSurfaces(e.ws).some((s) => isPreviewSurface(s) && s.path === path),
  );
  if (target) {
    activeWorkspaceIdx.set(target.idx);
    const pane = getAllPanes(target.ws.splitRoot).find(
      (p) => p.id === target.ws.activePaneId,
    );
    if (pane) {
      const hostedSurface = getAllSurfaces(target.ws).find(
        (s) => isPreviewSurface(s) && s.path === path,
      );
      if (hostedSurface) focusSurfaceById(hostedSurface.id);
    }
    return true;
  }

  // (3) No host yet — pick the first project workspace, switch, spawn.
  const first = projectWorkspaces[0];
  if (first) {
    activeWorkspaceIdx.set(first.idx);
    const pane = getAllPanes(first.ws.splitRoot).find(
      (p) => p.id === first.ws.activePaneId,
    );
    if (!pane) return false;
    const surface = createPreviewSurfaceInPane(pane.id, path, {
      focus: true,
      title: project.name,
    });
    return surface !== null;
  }

  // (4) No project workspaces — fall back to global active pane.
  const pane = get(activePane);
  if (!pane) return false;
  const surface = createPreviewSurfaceInPane(pane.id, path, {
    focus: true,
    title: project.name,
  });
  return surface !== null;
}

export const projectScopeManifest: ExtensionManifest = {
  id: "project-scope",
  name: "Project Scope",
  version: "0.1.0",
  description: "Group workspaces into projects",
  entry: "./index.ts",
  included: true,
  contributes: {
    // Projects no longer render as their own top-level sidebar section
    // — they render inline inside the Workspaces section alongside
    // root workspaces. The row-renderer registration happens at
    // activation (registerRootRowRenderer).
    workspaceActions: [
      {
        id: "new-project",
        title: "New Project...",
        icon: "folder-plus",
        // zone defaults to "workspace" → surfaces in the Workspaces
        // header "+ New" split-button dropdown alongside "New
        // Workspace" and any other workspace-zone actions.
      },
    ],
    commands: [
      { id: "create-project", title: "Create Project..." },
      { id: "open-project-dashboard", title: "Open Project Dashboard..." },
      {
        id: "promote-workspace-to-project",
        title: "Promote Workspace to Project...",
      },
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
  // Named handlers so onDeactivate's api.off() removes the same listeners
  // api.on() added. Without named refs, a disable/re-enable cycle stacks a
  // fresh copy of every handler each time (duplicate unclaim on close).
  const onWorkspaceCreated = (event: AppEvent) => {
    const metadata = event.metadata as Record<string, unknown> | undefined;
    const targetProjectId = metadata?.projectId as string | undefined;
    if (!targetProjectId) return;

    const workspaceId = event.id as string | undefined;
    if (!workspaceId) return;

    addWorkspaceToProject(api, targetProjectId, workspaceId);
    api.claimWorkspace(workspaceId);
  };

  const onWorkspaceClosed = (event: AppEvent) => {
    const workspaceId = event.id as string | undefined;
    if (!workspaceId) return;

    removeWorkspaceFromAllProjects(api, workspaceId);
    api.unclaimWorkspace(workspaceId);
  };

  api.onActivate(() => {
    // Register overlays — rendered generically by App.svelte. The
    // dashboard now opens as a PreviewSurface (see openProjectDashboard);
    // only the create-dialog still needs an overlay slot.
    api.registerOverlay("create-dialog", ProjectCreateOverlay);

    /**
     * Project creation flow using extension-owned overlay.
     * Stores a resolve callback in state so the overlay can resolve the
     * Promise directly — no polling needed.
     *
     * When a `prefill` is provided (e.g. from the Promote-to-Project
     * flow), the overlay opens with those fields already populated.
     * Returns the new project's id on success, null on cancel.
     */
    async function createProjectFlow(prefill?: {
      path: string;
      name?: string;
    }): Promise<string | null> {
      api.state.set("createDialogResult", null);
      if (prefill) {
        api.state.set("createDialogPrefill", prefill);
      } else {
        api.state.set("createDialogPrefill", null);
      }
      api.state.set("showCreateDialog", true);
      api.emit("extension:project:dialog-toggle", { visible: true });

      const result = await new Promise<{
        name: string;
        path: string;
        color: string;
      } | null>((resolve) => {
        api.state.set("createDialogResolve", resolve);
      });

      if (!result) return null;

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

      addProject(api, project);
      api.state.set("activeProjectId", id);
      return id;
    }

    /**
     * Promote the active, non-project workspace into a new project whose
     * root is that workspace's current working directory. Opens the
     * create dialog with path/name pre-filled, then moves the workspace
     * into the created project (assigns metadata.projectId + claims it).
     */
    async function promoteActiveWorkspaceToProject(): Promise<void> {
      let activeWs:
        | { id: string; name: string; cwd?: string }
        | null
        | undefined;
      const unsub = api.activeWorkspace.subscribe((ws) => {
        activeWs = ws as typeof activeWs;
      });
      unsub();
      if (!activeWs || !activeWs.id) return;

      // getActiveCwd is the source of truth — it observes the shell's
      // OSC 7 signal, so it's more accurate than whatever was persisted.
      const cwd = (await api.getActiveCwd()) || activeWs.cwd;
      if (!cwd) {
        api.reportError(
          "Cannot promote: could not determine workspace working directory.",
        );
        return;
      }

      const derivedName =
        cwd.replace(/\/+$/, "").split("/").pop() || activeWs.name;

      const newProjectId = await createProjectFlow({
        path: cwd,
        name: derivedName,
      });
      if (!newProjectId) return;

      // Move the workspace into the new project. The workspace:created
      // handler below claims workspaces tagged with metadata.projectId,
      // but promotion happens after creation, so we apply the same
      // bookkeeping manually.
      addWorkspaceToProject(api, newProjectId, activeWs.id);
      api.claimWorkspace(activeWs.id);
    }

    // Projects now render inline inside the Workspaces section,
    // interleaved with root workspaces. Core's WorkspaceListBlock
    // owns the rail/grip and drag pipeline; this registration tells
    // core how to render a row whose kind === "project". The
    // railColor resolver lets core paint the grip in the project's
    // own color so the rail reads as part of the project block.
    api.registerRootRowRenderer("project", ProjectRowBody, {
      railColor: (id: string) => {
        const project = getProjects(api).find((p) => p.id === id);
        if (!project) return undefined;
        return resolveProjectColor(project.color, get(api.theme));
      },
      label: (id: string) => getProjects(api).find((p) => p.id === id)?.name,
    });

    // "New Project" surfaces in the Workspaces header "+ New" split-
    // button dropdown. Declared in the manifest so toolchains (MCP,
    // palette) discover it; handler bound here.
    api.registerWorkspaceAction("new-project", {
      label: "New Project...",
      icon: "folder-plus",
      handler: () => {
        void createProjectFlow();
      },
    });

    // Load persisted projects. Workspace IDs are regenerated every restart
    // (they're not persisted), so clear the stale wsId list — the
    // workspace:created handler will rebuild it from each workspace's
    // metadata.projectId as workspaces are restored.
    clearWorkspaceIds(api);
    const projects = getProjects(api);

    // Seed rootRowOrder with each existing project. appendRootRow is
    // idempotent, so if a previous session already persisted an order
    // containing these ids the stored position is preserved.
    for (const project of projects) {
      api.appendRootRow({ kind: "project", id: project.id });
    }

    // Register per-project "New Workspace" commands for the command palette
    function registerProjectCommands(projects: ProjectEntry[]): void {
      for (const project of projects) {
        const cmdId = `new-ws-${project.id}`;
        api.registerCommand(
          cmdId,
          () => {
            const count =
              getProjects(api).find((p) => p.id === project.id)?.workspaceIds
                .length ?? 0;
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
    api.registerCommand("create-project", () => {
      void createProjectFlow();
    });
    api.registerCommand(
      "promote-workspace-to-project",
      promoteActiveWorkspaceToProject,
    );

    api.registerCommand("open-project-dashboard", () => {
      const projects = getProjects(api);
      if (projects.length === 0) return;

      const activeId = api.state.get<string | null>("activeProjectId");
      const project = activeId
        ? projects.find((p) => p.id === activeId)
        : projects[0];
      if (!project) return;

      void openProjectDashboard(project);
    });

    // Surfaced in PaneView's TabBar when the active workspace is a
    // project workspace. Resolves the workspace's projectId metadata
    // and spawns / focuses that project's dashboard preview.
    api.registerCommand(
      "project-scope:regenerate-active-project-dashboard",
      () => {
        let activeMetadata: Record<string, unknown> | undefined;
        const unsub = api.activeWorkspace.subscribe((w) => {
          activeMetadata = w?.metadata as Record<string, unknown> | undefined;
        });
        unsub();
        const projectId = activeMetadata?.projectId;
        if (typeof projectId !== "string") return;
        const project = getProjects(api).find((p) => p.id === projectId);
        if (project) void openProjectDashboard(project);
      },
      { title: "Spawn Project Dashboard" },
    );

    api.on("workspace:created", onWorkspaceCreated);
    api.on("workspace:closed", onWorkspaceClosed);
  });

  api.onDeactivate(() => {
    api.off("workspace:created", onWorkspaceCreated);
    api.off("workspace:closed", onWorkspaceClosed);

    // Resolve any in-flight createProjectFlow promise with null so it
    // unblocks. The overlay component unmounts on deactivate; without
    // this, the awaiter hangs forever and the state slot holds a stale
    // resolver that a later activation would re-use.
    const pending = api.state.get<((result: unknown) => void) | null>(
      "createDialogResolve",
    );
    if (typeof pending === "function") {
      pending(null);
    }
    api.state.set("createDialogResolve", null);
    api.state.set("showCreateDialog", false);
  });
}
