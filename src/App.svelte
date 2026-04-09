<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { theme, themes, xtermTheme } from "./lib/stores/theme";
  import {
    sidebarVisible,
    commandPaletteOpen,
    findBarVisible,
    pendingAction,
    currentView,
    currentProjectId,
    goHome,
    openWorkspace,
    loadingMessage,
  } from "./lib/stores/ui";
  import { showInputPrompt } from "./lib/stores/dialog-service";
  import { openNewWorkspace } from "./lib/workspace-actions";
  import {
    workspaces,
    activeWorkspaceIdx,
    activeWorkspace,
    activePane,
    activeSurface,
    notifyWorkspacesChanged,
  } from "./lib/stores/workspace";
  import {
    loadSettings,
    saveSettings,
    getSettings,
    getWorkspaceCommands,
    type WorkspaceDef,
    type LayoutNode,
  } from "./lib/settings";
  import {
    setupListeners,
    cleanupListeners,
    createTerminalSurface,
    fontReady,
    startCwdPolling,
    stopCwdPolling,
  } from "./lib/terminal-service";
  import {
    uid,
    getAllPanes,
    getAllSurfaces,
    isTerminalSurface,
    isHarnessSurface,
    findPane,
    getWorktreeEnv,
    type Workspace,
    type Pane,
    type SplitNode,
  } from "./lib/types";
  import {
    disposeSurface,
    removeSurfaceFromPane,
    collapsePaneFromTree,
    splitPane,
    disposeAllSurfaces,
    countActivePtys,
  } from "./lib/pane-service";
  import {
    createContextualSurface,
    createDiffSurface,
    createCommitDiffSurface,
  } from "./lib/surface-actions";
  import {
    openPreview,
    canPreview,
    getSupportedExtensions,
    refreshPreviewStyles,
  } from "./preview/index";
  import "./preview/init";
  import { type ThemeDef } from "./lib/theme-data";

  import Sidebar from "./lib/components/Sidebar.svelte";
  import HomeScreen from "./lib/components/HomeScreen.svelte";
  import { initProjects, projects } from "./lib/stores/project";
  import { loadState } from "./lib/state";
  import {
    handleKeydown as dispatchKeydown,
    type KeybindingActions,
  } from "./lib/keybindings";
  import {
    handleAddProject,
    handleNewWorkspace as handleNewWs,
    createFloatingWorkspace,
    restoreActiveWorkspaces,
  } from "./lib/workspace-actions";
  import { safeFocusTerminal } from "./lib/terminal-focus";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import WorkspaceView from "./lib/components/WorkspaceView.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import FindBar from "./lib/components/FindBar.svelte";
  import ContextMenu from "./lib/components/ContextMenu.svelte";
  import InputPrompt from "./lib/components/InputPrompt.svelte";
  import NewProjectDialog from "./lib/components/NewProjectDialog.svelte";
  import NewWorkspaceDialog from "./lib/components/NewWorkspaceDialog.svelte";
  import ConfirmDialog from "./lib/components/ConfirmDialog.svelte";
  import RightSidebar from "./lib/components/RightSidebar.svelte";
  import ProjectDashboard from "./lib/components/ProjectDashboard.svelte";
  import SettingsView from "./lib/components/SettingsView.svelte";
  import ProjectSettingsView from "./lib/components/ProjectSettingsView.svelte";
  import { showConfirmDialog } from "./lib/stores/dialog-service";

  let sidebarComponent: Sidebar;
  let findBarComponent: FindBar;
  const menuUnlisteners: UnlistenFn[] = [];

  // ---- Shared helpers ----

  function applyTheme(id: string) {
    theme.set(id);
    for (const ws of $workspaces) {
      for (const s of getAllSurfaces(ws)) {
        if (isTerminalSurface(s) || isHarnessSurface(s))
          s.terminal.options.theme = $xtermTheme;
      }
    }
    refreshPreviewStyles();
    saveSettings({ theme: id });
  }

  // ---- Workspace service functions ----

  // safeFocus is now safeFocusTerminal from terminal-focus.ts

  async function createWorkspaceFromDef(def: WorkspaceDef) {
    const wsName = def.name || `Workspace ${$workspaces.length + 1}`;
    const rootCwd = def.cwd;

    async function buildTree(
      nodeDef: LayoutNode,
      inheritedCwd?: string,
    ): Promise<SplitNode> {
      if ("pane" in nodeDef) {
        const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
        for (const sDef of nodeDef.pane.surfaces) {
          const cwd = sDef.cwd || inheritedCwd;
          if (sDef.type === "markdown" && sDef.path) {
            const surface = await openPreview(sDef.path);
            if (sDef.name) surface.title = sDef.name;
            pane.surfaces.push(surface);
            if (!pane.activeSurfaceId || sDef.focus)
              pane.activeSurfaceId = surface.id;
          } else if (sDef.type === "harness" && sDef.presetId) {
            const { createHarnessSurface } =
              await import("./lib/terminal-service");
            const surface = await createHarnessSurface(
              pane,
              sDef.presetId,
              cwd,
            );
            if (sDef.name) surface.title = sDef.name;
            if (sDef.focus) pane.activeSurfaceId = surface.id;
          } else {
            const surface = await createTerminalSurface(pane, cwd);
            if (sDef.name) surface.title = sDef.name;
            if (sDef.command) surface.startupCommand = sDef.command;
            if (sDef.focus) pane.activeSurfaceId = surface.id;
          }
        }
        if (pane.surfaces.length === 0) {
          await createTerminalSurface(pane, inheritedCwd);
        }
        return { type: "pane", pane };
      } else {
        const left = await buildTree(nodeDef.children[0], inheritedCwd);
        const right = await buildTree(nodeDef.children[1], inheritedCwd);
        return {
          type: "split",
          direction: nodeDef.direction,
          ratio: nodeDef.split || 0.5,
          children: [left, right],
        };
      }
    }

    let splitRoot: SplitNode;
    if (def.layout) {
      splitRoot = await buildTree(def.layout, rootCwd);
    } else {
      const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
      await createTerminalSurface(pane, rootCwd);
      splitRoot = { type: "pane", pane };
    }

    const ws: Workspace = {
      id: uid(),
      name: wsName,
      splitRoot,
      activePaneId: getAllPanes(splitRoot)[0]?.id ?? null,
    };

    workspaces.update((list) => [...list, ws]);
    activeWorkspaceIdx.set($workspaces.length - 1);
    const ap = getAllPanes(splitRoot).find((p) => p.id === ws.activePaneId);
    const as_ = ap?.surfaces.find((s) => s.id === ap.activeSurfaceId);
    safeFocusTerminal(as_);
  }

  function handleSwitchToWorkspace(wsId: string) {
    const idx = $workspaces.findIndex((ws) => ws.id === wsId);
    if (idx >= 0) {
      switchWorkspace(idx);
      openWorkspace();
    }
  }

  function switchWorkspace(idx: number) {
    if (idx < 0 || idx >= $workspaces.length) return;
    activeWorkspaceIdx.set(idx);
    // fit() and scrollToBottom() are handled by TerminalSurface's visibility transition.
    // Just need to set focus after the transition settles.
    safeFocusTerminal($activeSurface);
  }

  async function closeWorkspace(idx: number) {
    const ws = $workspaces[idx];
    if (!ws) return;

    const ptyCount = countActivePtys(ws);
    const msg =
      ptyCount > 0
        ? `Close "${ws.name}"? This will kill ${ptyCount} running process${ptyCount > 1 ? "es" : ""}.`
        : `Close "${ws.name}"?`;
    const confirmed = await showConfirmDialog(msg, {
      title: "Close Workspace",
      confirmLabel: "Close",
      danger: true,
    });
    if (!confirmed) return;

    disposeAllSurfaces(ws);

    // For managed workspaces, offer to clean up the git worktree
    if (
      ws.record?.type === "managed" &&
      ws.record.worktreePath &&
      ws.record.projectId
    ) {
      const shouldCleanup = await showConfirmDialog(
        `Remove the git worktree at ${ws.record.worktreePath}? This deletes the worktree directory.`,
        {
          title: "Clean Up Worktree",
          confirmLabel: "Remove Worktree",
          danger: true,
        },
      );
      if (shouldCleanup) {
        try {
          const state = await import("./lib/state");
          const project = state
            .getState()
            .projects.find((p) => p.id === ws.record!.projectId);
          if (project) {
            const { removeWorktree } = await import("./lib/git");
            await removeWorktree(project.path, ws.record.worktreePath!);
          }
        } catch (err) {
          await showConfirmDialog(`Worktree removal failed: ${err}`, {
            title: "Error",
            confirmLabel: "OK",
            danger: true,
          });
        }
      }
    }

    // Update persisted state first (source of truth), then sync Svelte store
    if (ws.record?.id) {
      const state = await import("./lib/state");
      if (ws.record.projectId) {
        state.removeWorkspace(ws.record.projectId, ws.record.id);
      } else {
        state.removeFloatingWorkspace(ws.record.id);
      }
      await state.saveState();
      (await import("./lib/stores/project")).initProjects();
    }

    // Mirror persisted state in Svelte store
    const remaining = $workspaces.filter((_, i) => i !== idx);
    workspaces.set(remaining);
    if (remaining.length === 0) {
      activeWorkspaceIdx.set(-1);
      goHome();
    } else {
      activeWorkspaceIdx.set(
        Math.min($activeWorkspaceIdx, remaining.length - 1),
      );
    }
  }

  async function renameWorkspace(idx: number, currentName: string) {
    const newName = await showInputPrompt("Rename workspace", currentName);
    if (!newName || newName === currentName) return;
    workspaces.update((list) => {
      list[idx].name = newName;
      // Also update persisted metadata if present
      if (list[idx].record) {
        list[idx].record!.name = newName;
      }
      return [...list];
    });
    // Persist the rename
    const ws = $workspaces[idx];
    if (ws?.record?.projectId && ws.record.id) {
      const { getState, saveState } = await import("./lib/state");
      const state = getState();
      const project = state.projects.find((p) => p.id === ws.record!.projectId);
      const wsMeta = project?.workspaces.find((w) => w.id === ws.record!.id);
      if (wsMeta) {
        wsMeta.name = newName;
        await saveState();
      }
    }
  }

  // ---- Pane/Surface service functions ----

  function handleSelectSurface(paneId: string, surfaceId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane) return;
    pane.activeSurfaceId = surfaceId;
    const s = pane.surfaces.find((s) => s.id === surfaceId);
    if (s) s.hasUnread = false;
    notifyWorkspacesChanged();
    safeFocusTerminal(s);
  }

  function handleCloseSurface(paneId: string, surfaceId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane) return;
    const idx = pane.surfaces.findIndex((s) => s.id === surfaceId);
    if (idx < 0) return;

    // If closing a harness in a managed workspace, replace with placeholder
    const surface = pane.surfaces[idx];
    if (isHarnessSurface(surface) && ws.record?.type === "managed") {
      disposeSurface(surface);
      const placeholder: import("./lib/types").HarnessPlaceholderSurface = {
        kind: "harness-placeholder",
        id: uid(),
        title: "Harness",
        presetId: surface.presetId,
        cwd: surface.cwd,
        hasUnread: false,
      };
      pane.surfaces.splice(idx, 1, placeholder);
      pane.activeSurfaceId = placeholder.id;
      notifyWorkspacesChanged();
      return;
    }

    removeSurface(ws, pane, idx);
  }

  function removeSurface(ws: Workspace, pane: Pane, surfaceIdx: number) {
    const newActive = removeSurfaceFromPane(pane, surfaceIdx);
    if (newActive === null) {
      removePane(ws, pane);
    } else {
      notifyWorkspacesChanged();
      const s = pane.surfaces.find((s) => s.id === newActive);
      safeFocusTerminal(s);
    }
  }

  async function handleRelaunchHarness(paneId: string, surfaceId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane) return;
    const idx = pane.surfaces.findIndex((s) => s.id === surfaceId);
    if (idx < 0) return;
    const placeholder = pane.surfaces[idx];
    if (placeholder.kind !== "harness-placeholder") return;

    const { createHarnessSurface, registerHarnessWithTracker } =
      await import("./lib/terminal-service");
    const cwd = placeholder.cwd || ws.record?.worktreePath;
    const worktreeEnv = getWorktreeEnv(ws);
    pane.surfaces.splice(idx, 1);
    const h = await createHarnessSurface(
      pane,
      placeholder.presetId,
      cwd,
      worktreeEnv,
    );
    if (h) {
      registerHarnessWithTracker(h);
      pane.activeSurfaceId = h.id;
    }
    notifyWorkspacesChanged();
    safeFocusTerminal(h);
  }

  /** Get the CWD — from active surface, then workspace record, then project path. */
  async function getActiveCwd(): Promise<string | undefined> {
    // Try active surface (terminal or harness)
    if (
      $activeSurface &&
      (isTerminalSurface($activeSurface) || isHarnessSurface($activeSurface))
    ) {
      if ($activeSurface.cwd) return $activeSurface.cwd;
      if ($activeSurface.ptyId >= 0) {
        try {
          const cwd = await invoke<string>("get_pty_cwd", {
            ptyId: $activeSurface.ptyId,
          });
          if (cwd) return cwd;
        } catch {}
      }
    }
    // Fall back to workspace worktree path or project path
    const ws = $activeWorkspace;
    if (ws?.record?.worktreePath) return ws.record.worktreePath;
    if (ws?.record?.projectId) {
      const { getState } = await import("./lib/state");
      const project = getState().projects.find(
        (p) => p.id === ws.record!.projectId,
      );
      if (project) return project.path;
    }
    return undefined;
  }

  async function handleNewSurface(paneId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane) return;
    const cwd = await getActiveCwd();
    const surface = await createTerminalSurface(pane, cwd);
    // Enforce worktree boundary for managed workspaces
    const env = getWorktreeEnv(ws);
    if (env) surface.env = env;
    notifyWorkspacesChanged();
    safeFocusTerminal(surface);
  }

  async function handleNewHarnessSurface(paneId: string, presetId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane) return;
    const cwd = await getActiveCwd();
    const worktreeEnv = getWorktreeEnv(ws);
    const { createHarnessSurface, registerHarnessWithTracker } =
      await import("./lib/terminal-service");
    const h = await createHarnessSurface(pane, presetId, cwd, worktreeEnv);
    if (h) registerHarnessWithTracker(h);
    notifyWorkspacesChanged();
    safeFocusTerminal(h);
  }

  async function handleSwitchSurface(
    paneId: string,
    kind: string,
    presetId?: string,
  ) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane) return;

    // Find and dispose the currently active surface
    const activeIdx = pane.surfaces.findIndex(
      (s) => s.id === pane.activeSurfaceId,
    );
    if (activeIdx >= 0) {
      disposeSurface(pane.surfaces[activeIdx]);
      pane.surfaces.splice(activeIdx, 1);
    }

    const cwd = await getActiveCwd();
    const worktreeEnv = getWorktreeEnv(ws);

    if (kind === "harness" && presetId) {
      const { createHarnessSurface, registerHarnessWithTracker } =
        await import("./lib/terminal-service");
      const h = await createHarnessSurface(pane, presetId, cwd, worktreeEnv);
      if (h) registerHarnessWithTracker(h);
      notifyWorkspacesChanged();
      safeFocusTerminal(h);
    } else if (
      kind === "diff" ||
      kind === "filebrowser" ||
      kind === "commithistory"
    ) {
      const wp = ws.record?.worktreePath;
      if (!wp) return;
      const newSurface = await createContextualSurface(
        kind,
        wp,
        ws.record?.baseBranch,
      );
      if (newSurface) {
        pane.surfaces.push(newSurface);
        pane.activeSurfaceId = newSurface.id;
        notifyWorkspacesChanged();
      }
    } else {
      const surface = await createTerminalSurface(pane, cwd);
      if (worktreeEnv) surface.env = worktreeEnv;
      notifyWorkspacesChanged();
      safeFocusTerminal(surface);
    }
  }

  // createContextualSurface imported from surface-actions.ts

  async function handleNewContextualSurface(paneId: string, kind: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane) return;
    const wp = ws.record?.worktreePath;
    if (!wp) return;
    const newSurface = await createContextualSurface(
      kind,
      wp,
      ws.record?.baseBranch,
    );
    if (newSurface) {
      pane.surfaces.push(newSurface);
      pane.activeSurfaceId = newSurface.id;
      notifyWorkspacesChanged();
    }
  }

  // findParentSplit and replaceNodeInTree imported from types.ts

  async function handleSplitPane(
    paneId: string,
    direction: "horizontal" | "vertical",
  ) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const targetPaneId = findPane(ws, paneId)?.id ?? $activePane?.id;
    if (!targetPaneId) return;

    const cwd = await getActiveCwd();
    const surface = await splitPane(ws, targetPaneId, direction, cwd);
    notifyWorkspacesChanged();
    safeFocusTerminal(surface);
  }

  function removePane(ws: Workspace, pane: Pane) {
    const shouldRemoveWorkspace = collapsePaneFromTree(ws, pane);
    if (shouldRemoveWorkspace) {
      const wsIdx = $workspaces.indexOf(ws);
      workspaces.update((list) => list.filter((w) => w.id !== ws.id));
      if ($workspaces.length === 0) {
        activeWorkspaceIdx.set(-1);
        goHome();
      } else {
        activeWorkspaceIdx.set(Math.min(wsIdx, $workspaces.length - 1));
      }
      return;
    }
    notifyWorkspacesChanged();
    safeFocusTerminal($activeSurface);
  }

  function handleClosePane(paneId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane) return;
    for (const s of [...pane.surfaces]) disposeSurface(s);
    pane.surfaces = [];
    removePane(ws, pane);
  }

  function handleFocusPane(paneId: string) {
    const ws = $activeWorkspace;
    if (!ws || ws.activePaneId === paneId) return;
    ws.activePaneId = paneId;
    notifyWorkspacesChanged();
  }

  function handleRenameTab(
    paneId: string,
    surfaceId: string,
    newTitle: string,
  ) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane) return;
    const surface = pane.surfaces.find((s) => s.id === surfaceId);
    if (surface) {
      surface.title = newTitle;
      notifyWorkspacesChanged();
    }
  }

  function handleReorderTab(paneId: string, fromIdx: number, toIdx: number) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = findPane(ws, paneId);
    if (!pane || fromIdx === toIdx) return;
    const [item] = pane.surfaces.splice(fromIdx, 1);
    pane.surfaces.splice(toIdx, 0, item);
    notifyWorkspacesChanged();
  }

  function handleSplitFromSidebar(direction: "horizontal" | "vertical") {
    const pane = $activePane;
    if (pane) handleSplitPane(pane.id, direction);
  }

  function handleNewSurfaceFromSidebar() {
    const pane = $activePane;
    if (pane) handleNewSurface(pane.id);
  }

  // ---- Focus direction ----
  function focusDirection(dir: "left" | "right" | "up" | "down") {
    const ws = $activeWorkspace;
    if (!ws) return;
    const panes = getAllPanes(ws.splitRoot);
    if (panes.length <= 1) return;
    const currentIdx = panes.findIndex((p) => p.id === ws.activePaneId);
    const nextIdx =
      dir === "right" || dir === "down"
        ? (currentIdx + 1) % panes.length
        : (currentIdx - 1 + panes.length) % panes.length;
    ws.activePaneId = panes[nextIdx].id;
    notifyWorkspacesChanged();
    const s = panes[nextIdx].surfaces.find(
      (s) => s.id === panes[nextIdx].activeSurfaceId,
    );
    safeFocusTerminal(s);
  }

  // ---- Pane zoom ----
  let zoomedPaneId: string | null = null;

  function togglePaneZoom() {
    const ws = $activeWorkspace;
    if (!ws) return;
    zoomedPaneId = zoomedPaneId ? null : ws.activePaneId;
    notifyWorkspacesChanged();
    // ResizeObserver handles fit() when the pane size changes.
    safeFocusTerminal($activeSurface);
  }

  // ---- Flash ----
  function flashFocusedPane() {
    const pane = $activePane;
    if (!pane?.element) return;
    const el = pane.element;
    el.style.boxShadow = `0 0 0 2px ${$theme.accent}, 0 0 16px ${$theme.accent}`;
    el.style.transition = "box-shadow 0.3s";
    setTimeout(() => {
      el.style.boxShadow = "";
      setTimeout(() => {
        el.style.transition = "";
      }, 300);
    }, 400);
  }

  // ---- Workspace serialization ----
  function serializeLayout(node: SplitNode): LayoutNode {
    if (node.type === "pane") {
      const surfaces = node.pane.surfaces.map((s) => {
        const type = isTerminalSurface(s)
          ? "terminal"
          : isHarnessSurface(s)
            ? "harness"
            : "markdown";
        const def: Record<string, string | boolean> = { type };
        if (s.title) def.name = s.title;
        if ((isTerminalSurface(s) || isHarnessSurface(s)) && s.cwd)
          def.cwd = s.cwd;
        if (isHarnessSurface(s)) def.presetId = s.presetId;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        if (!isTerminalSurface(s) && !isHarnessSurface(s) && "filePath" in s)
          def.path = (s as { filePath: string }).filePath;
        return def;
      });
      return { pane: { surfaces } };
    }
    return {
      direction: node.direction,
      split: node.ratio,
      children: [
        serializeLayout(node.children[0]),
        serializeLayout(node.children[1]),
      ],
    };
  }

  async function saveCurrentWorkspace() {
    const ws = $activeWorkspace;
    if (!ws) return;
    const name = await showInputPrompt("Workspace name", ws.name);
    if (!name) return;
    const layout = serializeLayout(ws.splitRoot);
    const activeCwd =
      $activeSurface && isTerminalSurface($activeSurface)
        ? $activeSurface.cwd
        : undefined;
    const wsDef: WorkspaceDef = { name, cwd: activeCwd || "~", layout };
    const config = getSettings();
    const commands = config.commands || [];
    const existing = commands.findIndex((c) => c.name === name);
    const entry = { name, workspace: wsDef };
    if (existing >= 0) {
      commands[existing] = entry;
    } else {
      commands.push(entry);
    }
    await saveSettings({ commands });
  }

  // ---- Derived state for right sidebar ----
  $: activeProject = $activeWorkspace?.record?.projectId
    ? $projects.find((p) => p.id === $activeWorkspace?.record?.projectId)
    : null;

  // ---- Command palette commands ----
  $: paletteCommands = [
    {
      name: "New Terminal Workspace",
      shortcut: "⌘N",
      action: () => handleNewFloatingWorkspace(),
    },
    {
      name: "New Surface (Tab)",
      shortcut: "⌘T",
      action: () => handleNewSurfaceFromSidebar(),
    },
    {
      name: "Split Right",
      shortcut: "⌘D",
      action: () => handleSplitFromSidebar("horizontal"),
    },
    {
      name: "Split Down",
      shortcut: "⇧⌘D",
      action: () => handleSplitFromSidebar("vertical"),
    },
    { name: "Close Surface", shortcut: "⌘W", action: () => closeSurface() },
    {
      name: "Close Workspace",
      shortcut: "⇧⌘W",
      action: () => closeWorkspace($activeWorkspaceIdx),
    },
    {
      name: "Toggle Pane Zoom",
      shortcut: "⇧⌘Enter",
      action: () => togglePaneZoom(),
    },
    { name: "Next Surface", shortcut: "⌘⇧]", action: () => nextSurface() },
    { name: "Previous Surface", shortcut: "⌘⇧[", action: () => prevSurface() },
    {
      name: "Toggle Sidebar",
      shortcut: "⌘B",
      action: () => sidebarVisible.update((v) => !v),
    },
    {
      name: "Toggle Find Bar",
      shortcut: "⌘F",
      action: () => findBarVisible.update((v) => !v),
    },
    {
      name: "Clear Scrollback",
      shortcut: "⌘K",
      action: () => {
        const s = $activeSurface;
        if (s && isTerminalSurface(s)) s.terminal.clear();
      },
    },
    ...$workspaces.map((ws, i) => ({
      name: `Switch to: ${ws.name}`,
      shortcut: i < 9 ? `⌘${i + 1}` : undefined,
      action: () => switchWorkspace(i),
    })),
    { name: "Save Current Workspace...", action: () => saveCurrentWorkspace() },
    {
      name: `Preview File...`,
      action: async () => {
        const path = await showInputPrompt("Path to file");
        if (path) openPreviewInPane(path);
      },
    },
    ...getWorkspaceCommands().map((cmd) => ({
      name: cmd.name,
      action: () => {
        if (cmd.workspace) createWorkspaceFromDef(cmd.workspace);
      },
    })),
    ...Object.entries(themes).map(([id, t]) => ({
      name: `Theme: ${t.name}`,
      action: () => applyTheme(id),
    })),
  ];

  async function openPreviewInPane(filePath: string) {
    const ws = $activeWorkspace;
    const pane = $activePane;
    if (!ws || !pane) return;
    const surface = await openPreview(filePath);
    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    notifyWorkspacesChanged();
  }

  async function openDiffInPane(worktreePath: string, filePath?: string) {
    const pane = $activePane;
    if (!pane) return;
    const surface = await createDiffSurface(worktreePath, filePath);
    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    notifyWorkspacesChanged();
  }

  async function openCommitInPane(
    worktreePath: string,
    commit: { hash: string; shortHash: string; subject: string },
  ) {
    const pane = $activePane;
    if (!pane) return;
    const surface = await createCommitDiffSurface(worktreePath, commit);
    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    notifyWorkspacesChanged();
  }

  async function openFileInEditor(filePath: string) {
    const pane = $activePane;
    if (!pane) return;
    const cwd = await getActiveCwd();
    const surface = await createTerminalSurface(pane, cwd);
    const ws = $activeWorkspace;
    if (ws) {
      const env = getWorktreeEnv(ws);
      if (env) surface.env = env;
    }
    const fileName = filePath.split("/").pop() || filePath;
    surface.title = `$EDITOR: ${fileName}`;
    surface.startupCommand = `\${EDITOR:-vi} ${filePath.includes(" ") ? `"${filePath}"` : filePath}`;
    notifyWorkspacesChanged();
    safeFocusTerminal(surface);
  }

  // ---- Pending action consumer (dispatched from terminal-service.ts + right sidebar) ----
  $: if ($pendingAction) {
    const action = $pendingAction;
    pendingAction.set(null);
    if (action.type === "open-preview" && action.payload) {
      openPreviewInPane(action.payload);
    } else if (action.type === "split-right") {
      handleSplitFromSidebar("horizontal");
    } else if (action.type === "split-down") {
      handleSplitFromSidebar("vertical");
    } else if (action.type === "open-diff" && action.payload) {
      openDiffInPane(action.payload.worktreePath, action.payload.filePath);
    } else if (action.type === "open-commit" && action.payload) {
      openCommitInPane(action.payload.worktreePath, action.payload.commit);
    } else if (action.type === "open-in-editor" && action.payload) {
      openFileInEditor(action.payload);
    }
  }

  // ---- Next/Prev surface ----
  function nextSurface() {
    const pane = $activePane;
    if (!pane || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId = pane.surfaces[(idx + 1) % pane.surfaces.length].id;
    notifyWorkspacesChanged();
    safeFocusTerminal($activeSurface);
  }

  function prevSurface() {
    const pane = $activePane;
    if (!pane || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId =
      pane.surfaces[(idx - 1 + pane.surfaces.length) % pane.surfaces.length].id;
    notifyWorkspacesChanged();
    safeFocusTerminal($activeSurface);
  }

  function selectSurface(num: number) {
    const pane = $activePane;
    if (!pane) return;
    const idx = num === 9 ? pane.surfaces.length - 1 : num - 1;
    if (idx >= 0 && idx < pane.surfaces.length) {
      pane.activeSurfaceId = pane.surfaces[idx].id;
      notifyWorkspacesChanged();
      safeFocusTerminal($activeSurface);
    }
  }

  function closeSurface() {
    const ws = $activeWorkspace;
    const pane = $activePane;
    if (!ws || !pane) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    if (idx < 0) return;
    removeSurface(ws, pane, idx);
  }

  // ---- Keyboard shortcuts (dispatched via keybindings.ts) ----
  const kbActions: KeybindingActions = {
    createWorkspace: () => handleNewFloatingWorkspace(),
    newSurface: handleNewSurfaceFromSidebar,
    splitHorizontal: () => handleSplitFromSidebar("horizontal"),
    splitVertical: () => handleSplitFromSidebar("vertical"),
    closeWorkspace: () => closeWorkspace($activeWorkspaceIdx),
    switchWorkspace,
    selectSurface,
    nextSurface,
    prevSurface,
    toggleSidebar: () => sidebarVisible.update((v) => !v),
    clearTerminal: () => {
      const s = $activeSurface;
      if (s && isTerminalSurface(s)) s.terminal.clear();
    },
    focusDirection,
    togglePaneZoom,
    flashFocusedPane,
    startRename: () => sidebarComponent?.startRename($activeWorkspaceIdx),
    toggleCommandPalette: () => commandPaletteOpen.update((v) => !v),
    toggleFindBar: () => findBarVisible.update((v) => !v),
    findNext: () => {
      findBarVisible.set(true);
      findBarComponent?.findNext();
    },
    findPrev: () => {
      findBarVisible.set(true);
      findBarComponent?.findPrev();
    },
    closeFindBar: () => findBarVisible.set(false),
    workspaceCount: () => $workspaces.length,
    activeIdx: () => $activeWorkspaceIdx,
    findBarVisible: () => $findBarVisible,
  };
  function handleKeydown(e: KeyboardEvent) {
    dispatchKeydown(e, kbActions);
  }

  // ---- Home screen handlers (delegated to workspace-actions.ts) ----

  async function handleNewHarness(presetId: string) {
    const pane = $activePane;
    if (!pane) return;
    const { createHarnessSurface } = await import("./lib/terminal-service");
    const cwd =
      $activeSurface && "cwd" in $activeSurface
        ? $activeSurface.cwd
        : undefined;
    await createHarnessSurface(pane, presetId, cwd);
    notifyWorkspacesChanged();
  }

  function handleNewWorkspace(projectId: string) {
    handleNewWs(projectId, (id) => sidebarComponent?.expandProject(id));
  }

  async function handleNewFloatingWorkspace() {
    const existing = $workspaces.filter(
      (ws) => ws.record && !ws.record.projectId,
    );
    const usedNames = new Set(existing.map((ws) => ws.name));
    let n = existing.length + 1;
    let name = `Terminal ${n}`;
    while (usedNames.has(name)) {
      n++;
      name = `Terminal ${n}`;
    }
    await createFloatingWorkspace(name);
  }

  // ---- Initialization ----
  onMount(async () => {
    await fontReady;
    await setupListeners();
    startCwdPolling();

    const config = await loadSettings();
    if (config.theme) {
      theme.set(config.theme);
    }

    // Load project state from disk, then seed the Svelte store
    await loadState();
    initProjects();

    // Restore all active workspaces from persisted project state
    await restoreActiveWorkspaces();

    // Autoload config-defined workspaces if none were restored
    if (
      $workspaces.length === 0 &&
      config.autoload &&
      config.autoload.length > 0 &&
      config.commands
    ) {
      for (const name of config.autoload) {
        const cmd = config.commands.find((c) => c.name === name && c.workspace);
        if (cmd?.workspace) {
          await createWorkspaceFromDef(cmd.workspace);
        }
      }
    }

    if ($workspaces.length === 0) {
      goHome();
    } else {
      openWorkspace();
    }

    // Listen for menu events
    menuUnlisteners.push(
      await listen<string>("menu-theme", (event) => {
        applyTheme(event.payload.replace("theme-", ""));
      }),
    );

    menuUnlisteners.push(
      await listen("menu-cmd-palette", () => {
        commandPaletteOpen.update((v) => !v);
      }),
    );

    menuUnlisteners.push(
      await listen("menu-close-tab", () => {
        closeSurface();
      }),
    );
  });

  onDestroy(() => {
    for (const unlisten of menuUnlisteners) {
      unlisten();
    }
    menuUnlisteners.length = 0;
    cleanupListeners();
    stopCwdPolling();
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div
  id="app"
  style="display: flex; flex-direction: column; height: 100vh; overflow: hidden;"
>
  <TitleBar />

  <div style="flex: 1; display: flex; min-height: 0; overflow: hidden;">
    <Sidebar
      bind:this={sidebarComponent}
      onSwitchWorkspace={switchWorkspace}
      onCloseWorkspace={closeWorkspace}
      onRenameWorkspace={renameWorkspace}
      onNewWorkspace={handleNewWorkspace}
      onNewFloatingWorkspace={handleNewFloatingWorkspace}
      onAddProject={handleAddProject}
    />

    <div
      style="
      flex: 1; display: flex; flex-direction: column;
      background: {$theme.bg}; min-width: 0; min-height: 0; overflow: hidden;
    "
    >
      {#if $currentView === "settings"}
        <SettingsView />
      {:else if $currentView === "project-settings" && $currentProjectId}
        <ProjectSettingsView />
      {:else if $currentView === "project" && $currentProjectId}
        <ProjectDashboard
          onSwitchToWorkspace={handleSwitchToWorkspace}
          onNewWorkspace={handleNewWorkspace}
        />
      {:else if $currentView === "home" || $workspaces.length === 0}
        <HomeScreen
          onSwitchToWorkspace={handleSwitchToWorkspace}
          onAddProject={handleAddProject}
          onNewWorkspace={handleNewWorkspace}
          onNewFloatingWorkspace={handleNewFloatingWorkspace}
        />
      {:else}
        <div
          style="flex: 1; display: flex; min-height: 0; min-width: 0; overflow: hidden;"
        >
          <div
            id="terminal-area"
            style="flex: 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; position: relative;"
          >
            {#each $workspaces as ws, i (ws.id)}
              <WorkspaceView
                workspace={ws}
                visible={i === $activeWorkspaceIdx}
                onSelectSurface={handleSelectSurface}
                onCloseSurface={handleCloseSurface}
                onNewSurface={handleNewSurface}
                onNewHarnessSurface={handleNewHarnessSurface}
                onSwitchSurface={handleSwitchSurface}
                onSplitRight={(paneId) => handleSplitPane(paneId, "horizontal")}
                onSplitDown={(paneId) => handleSplitPane(paneId, "vertical")}
                onClosePane={handleClosePane}
                onFocusPane={handleFocusPane}
                onRenameTab={handleRenameTab}
                onReorderTab={handleReorderTab}
                onRelaunchHarness={handleRelaunchHarness}
                worktreePath={ws.record?.worktreePath}
                baseBranch={ws.record?.baseBranch}
                onNewContextualSurface={handleNewContextualSurface}
              />
            {/each}

            <FindBar bind:this={findBarComponent} />
          </div>

          <RightSidebar
            meta={$activeWorkspace?.record}
            visible={$activeWorkspace?.rightSidebarOpen ?? false}
            projectPath={activeProject?.path}
            gitBacked={activeProject?.gitBacked ?? false}
            activeCwd={$activeSurface && "cwd" in $activeSurface
              ? $activeSurface.cwd
              : undefined}
          />
        </div>
      {/if}
    </div>
  </div>
</div>

<CommandPalette commands={paletteCommands} />
<ContextMenu />
<InputPrompt />
<NewProjectDialog />
<NewWorkspaceDialog />
<ConfirmDialog />

{#if $loadingMessage}
  <div
    style="
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
    background: {$theme.accent}; color: white; padding: 6px 16px;
    font-size: 12px; font-weight: 500; text-align: center;
  "
  >
    {$loadingMessage}
  </div>
{/if}
