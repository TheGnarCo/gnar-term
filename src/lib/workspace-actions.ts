/**
 * Workspace Actions — project/workspace lifecycle operations.
 *
 * Extracted from App.svelte to keep the component focused on layout.
 * Each function handles a complete user action (add project, create
 * workspace, restore workspaces on startup).
 */
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { uid, type Workspace, type Pane, type WorkspaceRecord } from "./types";
import { workspaces, activeWorkspaceIdx } from "./stores/workspace";
import { openWorkspace, loadingMessage } from "./stores/ui";
import {
  showNewProjectDialog,
  showNewWorkspaceDialog,
} from "./stores/dialog-service";
import { registerProject } from "./stores/project";
import { getSettings, getProjectAutoSpawnHarnesses } from "./settings";
import { createTerminalSurface } from "./terminal-service";
import { safeFocusTerminal } from "./terminal-focus";

/** Build a runtime workspace from metadata, create surfaces, add to store.
 *  When harnessPresets is provided, spawns each preset. Otherwise uses defaultHarness. */
export async function openNewWorkspace(
  wsMeta: WorkspaceRecord,
  cwd: string,
  launchHarness: boolean,
  harnessPresets?: string[],
): Promise<import("./types").Surface> {
  const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const ws: Workspace = {
    id: uid(),
    name: wsMeta.name,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    record: wsMeta,
    rightSidebarOpen: wsMeta.type === "managed",
  };
  // For managed workspaces, set GNARTERM_WORKTREE_ROOT to enforce boundary
  const worktreeEnv =
    wsMeta.type === "managed" && cwd
      ? { GNARTERM_WORKTREE_ROOT: cwd }
      : undefined;

  let activeSurface: import("./types").Surface;
  if (launchHarness) {
    const { createHarnessSurface, registerHarnessWithTracker } =
      await import("./terminal-service");
    const presets =
      harnessPresets && harnessPresets.length > 0
        ? harnessPresets
        : [getSettings().defaultHarness || "claude"];
    // Spawn each harness preset
    let firstHarness: import("./types").HarnessSurface | null = null;
    for (const presetId of presets) {
      const h = await createHarnessSurface(pane, presetId, cwd, worktreeEnv);
      if (h) {
        registerHarnessWithTracker(h);
        if (!firstHarness) firstHarness = h;
      }
    }
    // Create terminal tab alongside the harnesses
    const termSurface = await createTerminalSurface(pane, cwd);
    if (worktreeEnv) termSurface.env = worktreeEnv;
    // Focus the first harness tab
    if (firstHarness) {
      pane.activeSurfaceId = firstHarness.id;
      activeSurface = firstHarness;
    } else {
      activeSurface = termSurface;
    }
  } else {
    const surface = await createTerminalSurface(pane, cwd);
    if (worktreeEnv) surface.env = worktreeEnv;
    activeSurface = surface;
  }
  workspaces.update((list) => [...list, ws]);
  return activeSurface;
}

/** Show the New Project dialog and register the project */
export async function handleAddProject(): Promise<void> {
  const result = await showNewProjectDialog();
  if (!result) return;

  if (result.mode === "local") {
    const name = result.path.split("/").filter(Boolean).pop() || "project";
    await registerProject(result.path, name);
  } else {
    const repoName =
      result.url
        .split("/")
        .pop()
        ?.replace(/\.git$/, "") || "project";
    const settings = getSettings();
    const home = await invoke<string>("get_home");
    const baseDir = settings.projectsDir.replace(/^~/, home);
    const targetDir = `${baseDir}/${repoName}`;
    try {
      loadingMessage.set(`Cloning ${repoName}...`);
      await invoke("ensure_dir", { path: baseDir });
      const { cloneProject } = await import("./git");
      await cloneProject(result.url, targetDir);
      await registerProject(targetDir, repoName);
    } catch (err) {
      const { showConfirmDialog } = await import("./stores/dialog-service");
      await showConfirmDialog(`Clone failed: ${err}`, {
        title: "Error",
        confirmLabel: "OK",
        danger: true,
      });
    } finally {
      loadingMessage.set(null);
    }
  }
}

/** Show the New Workspace dialog and create the workspace */
export async function handleNewWorkspace(
  projectId: string,
  expandProject: (id: string) => void,
): Promise<void> {
  const { getState } = await import("./state");
  const project = getState().projects.find((p) => p.id === projectId);
  if (!project) return;

  const settings = getSettings();
  const result = await showNewWorkspaceDialog(
    projectId,
    project.path,
    project.gitBacked,
    settings.worktreePrefix || "",
  );
  if (!result) return;

  if (result.type === "terminal") {
    await createTerminalWorkspace(
      projectId,
      result.name,
      project.path,
      expandProject,
    );
  } else if (result.type === "managed") {
    await createWorktreeWorkspace(
      projectId,
      result.branch,
      result.baseBranch,
      project.path,
      expandProject,
    );
  } else if (result.type === "existing-worktree") {
    await attachExistingWorktree(
      projectId,
      result.branch,
      result.worktreePath,
      expandProject,
    );
  }
}

async function createTerminalWorkspace(
  projectId: string,
  name: string,
  projectPath: string,
  expandProject: (id: string) => void,
): Promise<void> {
  const { addWorkspace, saveState } = await import("./state");
  const wsMeta: WorkspaceRecord = {
    id: uid(),
    type: "terminal",
    name,
    status: "active",
    createdAt: Date.now(),
    projectId,
  };
  addWorkspace(projectId, wsMeta);
  await saveState();
  (await import("./stores/project")).initProjects();

  const surface = await openNewWorkspace(wsMeta, projectPath, false);
  activeWorkspaceIdx.set(get(workspaces).length - 1);
  expandProject(projectId);
  openWorkspace();
  safeFocusTerminal(surface);
}

async function attachExistingWorktree(
  projectId: string,
  branch: string,
  worktreePath: string,
  expandProject: (id: string) => void,
): Promise<void> {
  // If selecting a remote branch, checkout locally first
  if (branch.includes("/")) {
    try {
      const { gitCheckout } = await import("./git");
      // Strip remote prefix for checkout (e.g. "origin/main" -> "main")
      const localName = branch.replace(/^[^/]+\//, "");
      await gitCheckout(worktreePath, localName);
      branch = localName;
    } catch (err) {
      const { showConfirmDialog } = await import("./stores/dialog-service");
      await showConfirmDialog(`Checkout failed: ${err}`, {
        title: "Error",
        confirmLabel: "OK",
        danger: true,
      });
      return;
    }
  }

  const { addWorkspace, saveState } = await import("./state");
  const wsMeta: WorkspaceRecord = {
    id: uid(),
    type: "managed",
    name: branch,
    status: "active",
    createdAt: Date.now(),
    projectId,
    branch,
    worktreePath,
  };
  addWorkspace(projectId, wsMeta);
  await saveState();
  (await import("./stores/project")).initProjects();

  const { getState } = await import("./state");
  const project = getState().projects.find((p) => p.id === projectId);
  const autoPresets = project
    ? await getProjectAutoSpawnHarnesses(project.path)
    : undefined;
  const surface = await openNewWorkspace(
    wsMeta,
    worktreePath,
    true,
    autoPresets,
  );
  activeWorkspaceIdx.set(get(workspaces).length - 1);
  expandProject(projectId);
  openWorkspace();
  safeFocusTerminal(surface);
}

async function createWorktreeWorkspace(
  projectId: string,
  branch: string,
  baseBranch: string,
  projectPath: string,
  expandProject: (id: string) => void,
): Promise<void> {
  try {
    loadingMessage.set(`Creating worktree ${branch}...`);
    const { createWorktree, copyFiles, runScript } = await import("./git");
    const worktreePath = await createWorktree(projectPath, branch, baseBranch);

    // Run lifecycle: copy files then setup script
    const { loadProjectSettings } = await import("./settings");
    const projectSettings = await loadProjectSettings(
      projectPath,
      getSettings(),
    );
    if (projectSettings.copyFiles.length > 0) {
      loadingMessage.set(`Copying files to ${branch}...`);
      await copyFiles(
        projectPath,
        worktreePath,
        projectSettings.copyFiles,
      ).catch(() => {});
    }
    if (projectSettings.setup) {
      loadingMessage.set(`Running setup in ${branch}...`);
      await runScript(worktreePath, projectSettings.setup).catch(() => {});
    }

    const { addWorkspace, saveState } = await import("./state");
    const wsMeta: WorkspaceRecord = {
      id: uid(),
      type: "managed",
      name: branch,
      status: "active",
      createdAt: Date.now(),
      projectId,
      branch,
      baseBranch,
      worktreePath,
    };
    addWorkspace(projectId, wsMeta);
    await saveState();
    (await import("./stores/project")).initProjects();

    const autoPresets = await getProjectAutoSpawnHarnesses(projectPath);
    const surface = await openNewWorkspace(
      wsMeta,
      worktreePath,
      true,
      autoPresets,
    );
    activeWorkspaceIdx.set(get(workspaces).length - 1);
    expandProject(projectId);
    openWorkspace();
    safeFocusTerminal(surface);
  } catch (err) {
    const { showConfirmDialog } = await import("./stores/dialog-service");
    await showConfirmDialog(`Worktree creation failed: ${err}`, {
      title: "Error",
      confirmLabel: "OK",
      danger: true,
    });
  } finally {
    loadingMessage.set(null);
  }
}

/** Create a managed workspace for a GitHub issue, send the issue context to the harness. */
export async function sendIssueToAgent(
  projectId: string,
  projectPath: string,
  issue: { number: number; title: string; url: string },
): Promise<void> {
  const settings = getSettings();
  const prefix = settings.worktreePrefix || "";
  // Derive branch name from issue: "gnar/42-fix-login-bug"
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const branch = `${prefix}${issue.number}-${slug}`;

  try {
    loadingMessage.set(`Creating workspace for #${issue.number}...`);
    const {
      createWorktree,
      copyFiles: copyFilesFn,
      runScript,
    } = await import("./git");
    const worktreePath = await createWorktree(projectPath, branch, "main");

    const { loadProjectSettings } = await import("./settings");
    const projectSettings = await loadProjectSettings(projectPath, settings);
    if (projectSettings.copyFiles.length > 0) {
      loadingMessage.set(`Copying files...`);
      await copyFilesFn(
        projectPath,
        worktreePath,
        projectSettings.copyFiles,
      ).catch(() => {});
    }
    if (projectSettings.setup) {
      loadingMessage.set(`Running setup...`);
      await runScript(worktreePath, projectSettings.setup).catch(() => {});
    }

    const { addWorkspace, saveState } = await import("./state");
    const wsMeta: WorkspaceRecord = {
      id: uid(),
      type: "managed",
      name: `#${issue.number}: ${issue.title}`,
      status: "active",
      createdAt: Date.now(),
      projectId,
      branch,
      baseBranch: "main",
      worktreePath,
    };
    addWorkspace(projectId, wsMeta);
    await saveState();
    (await import("./stores/project")).initProjects();

    const autoPresets = await getProjectAutoSpawnHarnesses(projectPath);
    const surface = await openNewWorkspace(
      wsMeta,
      worktreePath,
      true,
      autoPresets,
    );
    activeWorkspaceIdx.set(get(workspaces).length - 1);
    openWorkspace();
    safeFocusTerminal(surface);

    // Send issue context to the harness after a brief delay for PTY to connect
    setTimeout(async () => {
      const ws = get(workspaces).find((w) => w.record?.branch === branch);
      if (!ws) return;
      const { getAllSurfaces, isHarnessSurface } = await import("./types");
      for (const s of getAllSurfaces(ws)) {
        if (isHarnessSurface(s) && s.ptyId >= 0) {
          const prompt = `Fix issue #${issue.number}: ${issue.title}\n${issue.url}\n`;
          invoke("write_pty", { ptyId: s.ptyId, data: prompt });
          break;
        }
      }
    }, 2000);
  } catch (err) {
    const { showConfirmDialog } = await import("./stores/dialog-service");
    await showConfirmDialog(`Failed to create workspace for issue: ${err}`, {
      title: "Error",
      confirmLabel: "OK",
      danger: true,
    });
  } finally {
    loadingMessage.set(null);
  }
}

/** Create a floating terminal workspace (not attached to any project) */
export async function createFloatingWorkspace(name: string): Promise<void> {
  const { addFloatingWorkspace, saveState } = await import("./state");
  const home = await invoke<string>("get_home");
  const settings = getSettings();
  const projectsDir = settings.projectsDir.replace(/^~/, home);
  const wsMeta: WorkspaceRecord = {
    id: uid(),
    type: "terminal",
    name,
    status: "active",
    createdAt: Date.now(),
  };
  addFloatingWorkspace(wsMeta);
  await saveState();

  const surface = await openNewWorkspace(wsMeta, projectsDir, false);
  activeWorkspaceIdx.set(get(workspaces).length - 1);
  openWorkspace();
  safeFocusTerminal(surface);
}

/** Restore all active workspaces from persisted state on startup */
export async function restoreActiveWorkspaces(): Promise<void> {
  const { getState } = await import("./state");
  const state = getState();
  const $ws = get(workspaces);
  const home = await invoke<string>("get_home");

  // Restore floating workspaces (open in projects directory)
  const settings = getSettings();
  const projectsDir = settings.projectsDir.replace(/^~/, home);
  for (const wsMeta of state.floatingWorkspaces) {
    if (wsMeta.status !== "active") continue;
    if ($ws.some((ws) => ws.record?.id === wsMeta.id)) continue;
    await openNewWorkspace(wsMeta, projectsDir, false);
  }

  // Restore project workspaces
  for (const project of state.projects) {
    if (!project.active) continue;
    for (const wsMeta of project.workspaces) {
      if (wsMeta.status !== "active") continue;
      if (get(workspaces).some((ws) => ws.record?.id === wsMeta.id)) continue;

      const cwd = wsMeta.worktreePath || project.path;
      const meta = { ...wsMeta, projectId: project.id };
      await openNewWorkspace(meta, cwd, wsMeta.type === "managed");
    }
  }

  if (get(workspaces).length > 0 && get(activeWorkspaceIdx) < 0) {
    activeWorkspaceIdx.set(0);
  }
}
