/**
 * Project Scope — included extension
 *
 * Groups workspaces into projects. Each project registers its own
 * primary sidebar section, showing nested workspaces and contextual
 * workspace actions. Manages its own overlays (create dialog) via the
 * overlay registry — no core store dependencies.
 *
 * Project dashboards render as PreviewSurfaces backed by a templated
 * markdown file at `<projectPath>/.gnar-term/project-dashboard.md`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ExtensionManifest, ExtensionAPI, AppEvent } from "../api";
import { resolveProjectColor } from "../api";
import { get } from "svelte/store";
import ProjectRowBody from "./ProjectRowBody.svelte";
import ProjectCreateOverlay from "./ProjectCreateOverlay.svelte";
import { createWorkspaceFromDef } from "../../lib/services/workspace-service";
import { workspaces, activeWorkspaceIdx } from "../../lib/stores/workspace";
import {
  getWorkspaceGroups,
  addWorkspaceGroup,
  addWorkspaceToGroup,
  removeWorkspaceFromAllGroups,
  clearWorkspaceIds,
  updateWorkspaceGroup,
} from "./project-service";

/**
 * A Workspace Group: a named, colored grouping of workspaces rooted at
 * a path. Workspaces join a group by carrying `metadata.groupId`.
 */
export interface WorkspaceGroupEntry {
  id: string;
  name: string;
  path: string;
  color: string;
  workspaceIds: string[];
  isGit: boolean;
  createdAt: string;
  /**
   * Id of the Dashboard workspace that hosts this group's markdown
   * Live Preview. Set when the Dashboard is created eagerly on group
   * creation. Resolved from the workspaces store by consumers.
   */
  dashboardWorkspaceId?: string;
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
 * the gnar:agent-list widget without an `orchestratorId` so it shows
 * every agent in the registry (the project's own scope is implicit
 * through the surface's location).
 */
function buildProjectDashboardMarkdown(project: WorkspaceGroupEntry): string {
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
  project: WorkspaceGroupEntry,
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
 * Create the Dashboard workspace for a project: a constrained workspace
 * (metadata.isDashboard = true) hosting a single Live Preview of the
 * project's markdown file. Returns the new workspace id so the project
 * record can link to it.
 */
async function createProjectDashboardWorkspace(
  project: WorkspaceGroupEntry,
): Promise<string> {
  const path = projectDashboardPath(project.path);
  try {
    await writeProjectDashboardTemplate(project, path);
  } catch {
    // Best-effort write — the workspace can still be created; the
    // preview surface will surface the backing-file error if relevant.
  }
  return await createWorkspaceFromDef({
    name: "Dashboard",
    layout: {
      pane: {
        surfaces: [
          {
            type: "preview",
            path,
            name: project.name,
            focus: true,
          },
        ],
      },
    },
    metadata: {
      isDashboard: true,
      groupId: project.id,
    },
  });
}

/**
 * Switch to a project's Dashboard workspace. The Dashboard is created
 * eagerly on project creation, so this is a pure activation call.
 * Returns true on success.
 */
export function openProjectDashboard(project: WorkspaceGroupEntry): boolean {
  const targetId = project.dashboardWorkspaceId;
  if (!targetId) return false;
  const idx = get(workspaces).findIndex((w) => w.id === targetId);
  if (idx < 0) return false;
  activeWorkspaceIdx.set(idx);
  return true;
}

export const projectScopeManifest: ExtensionManifest = {
  id: "workspace-groups",
  name: "Workspace Groups",
  version: "0.1.0",
  description: "Group workspaces into named, path-rooted collections",
  entry: "./index.ts",
  included: true,
  contributes: {
    // Workspace groups render inline inside the Workspaces section
    // alongside root workspaces. The row-renderer registration happens
    // at activation (registerRootRowRenderer).
    workspaceActions: [
      {
        id: "new-workspace-group",
        title: "New Workspace Group...",
        icon: "folder-plus",
        // zone defaults to "workspace" → surfaces in the Workspaces
        // header "+ New" split-button dropdown alongside "New
        // Workspace" and any other workspace-zone actions.
      },
    ],
    commands: [
      { id: "create-workspace-group", title: "Create Workspace Group..." },
      {
        id: "open-group-dashboard",
        title: "Open Workspace Group Dashboard...",
      },
      {
        id: "promote-workspace-to-group",
        title: "Promote Workspace to Workspace Group...",
      },
    ],
    events: [
      "workspace:created",
      "workspace:closed",
      "workspace:activated",
      "extension:workspace-group:dashboard-opened",
      "extension:workspace-group:dialog-toggle",
      "extension:workspace-group:state-changed",
    ],
  },
};

export function registerProjectScopeExtension(api: ExtensionAPI): void {
  // Named handlers so onDeactivate's api.off() removes the same listeners
  // api.on() added. Without named refs, a disable/re-enable cycle stacks a
  // fresh copy of every handler each time (duplicate unclaim on close).
  const onWorkspaceCreated = (event: AppEvent) => {
    const metadata = event.metadata as Record<string, unknown> | undefined;
    const targetGroupId = metadata?.groupId as string | undefined;
    if (!targetGroupId) return;

    const workspaceId = event.id as string | undefined;
    if (!workspaceId) return;

    addWorkspaceToGroup(api, targetGroupId, workspaceId);
    api.claimWorkspace(workspaceId);
  };

  const onWorkspaceClosed = (event: AppEvent) => {
    const workspaceId = event.id as string | undefined;
    if (!workspaceId) return;

    removeWorkspaceFromAllGroups(api, workspaceId);
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
      api.emit("extension:workspace-group:dialog-toggle", { visible: true });

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
      const project: WorkspaceGroupEntry = {
        id,
        name: result.name,
        path: result.path,
        color: result.color,
        workspaceIds: [],
        isGit,
        createdAt: new Date().toISOString(),
      };

      addWorkspaceGroup(api, project);

      // Eagerly spawn the group's Dashboard workspace. The
      // workspace:created event below will claim it (metadata.groupId
      // is set), and it will appear as the first tile in the group's
      // nested list.
      try {
        const dashboardWorkspaceId =
          await createProjectDashboardWorkspace(project);
        updateWorkspaceGroup(api, id, { dashboardWorkspaceId });
      } catch (err) {
        api.reportError(
          `Failed to create project Dashboard workspace: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      api.state.set("activeGroupId", id);
      return id;
    }

    /**
     * Promote the active, ungrouped workspace into a new workspace
     * group whose root is that workspace's current working directory.
     * Opens the create dialog with path/name pre-filled, then moves
     * the workspace into the created group (assigns metadata.groupId
     * + claims it).
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

      // Move the workspace into the new group. The workspace:created
      // handler below claims workspaces tagged with metadata.groupId,
      // but promotion happens after creation, so we apply the same
      // bookkeeping manually.
      addWorkspaceToGroup(api, newProjectId, activeWs.id);
      api.claimWorkspace(activeWs.id);
    }

    // Workspace groups render inline inside the Workspaces section,
    // interleaved with root workspaces. Core's WorkspaceListBlock
    // owns the rail/grip and drag pipeline; this registration tells
    // core how to render a row whose kind === "workspace-group". The
    // railColor resolver lets core paint the grip in the group's
    // own color so the rail reads as part of the group block.
    api.registerRootRowRenderer("workspace-group", ProjectRowBody, {
      railColor: (id: string) => {
        const project = getWorkspaceGroups(api).find((p) => p.id === id);
        if (!project) return undefined;
        return resolveProjectColor(project.color, get(api.theme));
      },
      label: (id: string) =>
        getWorkspaceGroups(api).find((p) => p.id === id)?.name,
    });

    // "New Workspace Group" surfaces in the Workspaces header "+ New"
    // split-button dropdown. Declared in the manifest so toolchains
    // (MCP, palette) discover it; handler bound here.
    api.registerWorkspaceAction("new-workspace-group", {
      label: "New Workspace Group...",
      icon: "folder-plus",
      handler: () => {
        void createProjectFlow();
      },
    });

    // Load persisted groups. Workspace IDs are regenerated every restart
    // (they're not persisted), so clear the stale wsId list — the
    // workspace:created handler will rebuild it from each workspace's
    // metadata.groupId as workspaces are restored.
    clearWorkspaceIds(api);
    const projects = getWorkspaceGroups(api);

    // Seed rootRowOrder with each existing group. appendRootRow is
    // idempotent, so if a previous session already persisted an order
    // containing these ids the stored position is preserved.
    for (const project of projects) {
      api.appendRootRow({ kind: "workspace-group", id: project.id });
    }

    // Ensure each project has a Dashboard workspace. New projects get
    // one via createProjectFlow; this reconciliation catches anything
    // that was lost (first run after the redesign, corruption). Fires
    // asynchronously; UI handles missing workspaces gracefully until
    // it completes.
    void (async () => {
      for (const project of getWorkspaceGroups(api)) {
        const hasWs =
          !!project.dashboardWorkspaceId &&
          get(workspaces).some((w) => w.id === project.dashboardWorkspaceId);
        if (hasWs) continue;
        try {
          const dashboardWorkspaceId =
            await createProjectDashboardWorkspace(project);
          updateWorkspaceGroup(api, project.id, { dashboardWorkspaceId });
        } catch (err) {
          console.warn(
            "[workspace-groups] Dashboard reconciliation failed:",
            err,
          );
        }
      }
    })();

    // Register per-project "New Workspace" commands for the command palette
    function registerProjectCommands(projects: WorkspaceGroupEntry[]): void {
      for (const project of projects) {
        const cmdId = `new-ws-${project.id}`;
        api.registerCommand(
          cmdId,
          () => {
            const count =
              getWorkspaceGroups(api).find((p) => p.id === project.id)
                ?.workspaceIds.length ?? 0;
            api.createWorkspace(
              `${project.name} Workspace ${count + 1}`,
              project.path,
              { metadata: { groupId: project.id } },
            );
          },
          { title: `${project.name}: New Workspace` },
        );
      }
    }
    registerProjectCommands(projects);

    // Commands
    api.registerCommand("create-workspace-group", () => {
      void createProjectFlow();
    });
    api.registerCommand(
      "promote-workspace-to-group",
      promoteActiveWorkspaceToProject,
    );

    api.registerCommand("open-group-dashboard", () => {
      const projects = getWorkspaceGroups(api);
      if (projects.length === 0) return;

      const activeId = api.state.get<string | null>("activeGroupId");
      const project = activeId
        ? projects.find((p) => p.id === activeId)
        : projects[0];
      if (!project) return;

      void openProjectDashboard(project);
    });

    // Surfaced in PaneView's TabBar when the active workspace belongs
    // to a workspace group. Resolves the workspace's groupId metadata
    // and spawns / focuses that group's dashboard preview.
    api.registerCommand(
      "workspace-groups:regenerate-active-group-dashboard",
      () => {
        let activeMetadata: Record<string, unknown> | undefined;
        const unsub = api.activeWorkspace.subscribe((w) => {
          activeMetadata = w?.metadata as Record<string, unknown> | undefined;
        });
        unsub();
        const groupId = activeMetadata?.groupId;
        if (typeof groupId !== "string") return;
        const project = getWorkspaceGroups(api).find((p) => p.id === groupId);
        if (project) void openProjectDashboard(project);
      },
      { title: "Spawn Workspace Group Dashboard" },
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
