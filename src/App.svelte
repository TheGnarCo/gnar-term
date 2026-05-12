<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { theme, themes, xtermTheme } from "./lib/stores/theme";
  import { fontSize, setFontSizeFromConfig } from "./lib/stores/font-size";
  import {
    isFullscreen,
    sidebarVisible,
    commandPaletteOpen,
    findBarVisible,
    pendingAction,
    installPointerWindowListeners,
  } from "./lib/stores/ui";
  import {
    workspaces,
    activeWorkspaceIdx,
    activeWorkspace,
    activePane,
    activeSurface,
    activePseudoWorkspaceId,
  } from "./lib/stores/workspace";
  import { pseudoWorkspaceStore } from "./lib/services/pseudo-workspace-registry";
  import {
    rootRowOrder,
    bootstrapRootRowOrder,
    type RootRow,
  } from "./lib/stores/root-row-order";
  import { get } from "svelte/store";
  import { invoke } from "@tauri-apps/api/core";
  import {
    loadConfig,
    saveConfig,
    getState,
    getWorkspaceCommands,
  } from "./lib/config";
  import { registerTheme } from "./lib/services/theme-registry";
  import {
    setupListeners,
    fontReady,
    startCwdPolling,
    registerCwdChangeHook,
    isMac,
    modLabel,
    shiftModLabel,
    adjustFontSize,
    resetFontSize,
    clearAllTerminalAtlases,
  } from "./lib/terminal-service";
  import { getAllPanes, getAllSurfaces, isTerminalSurface } from "./lib/types";
  import { forEachTerminalSurface } from "./lib/services/service-helpers";
  import { check } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { ask, message } from "@tauri-apps/plugin-dialog";
  import { eventBus } from "./lib/services/event-bus";
  import { initDragDropPaneRouter } from "./lib/services/drag-drop-pane-router";
  import { handleMenuPaste } from "./lib/services/menu-paste-router";

  // Extension lifecycle
  import {
    extensionStore,
    extensionErrorStore,
    reportExtensionError,
    flushAllExtensionState,
    getExtensionApiById,
  } from "./lib/services/extension-loader";
  import ExtensionWrapper from "./lib/components/ExtensionWrapper.svelte";
  import { loadExternalExtensions } from "./lib/services/extension-management";
  import { registerIncludedExtensions } from "./lib/bootstrap/register-included-extensions";
  import { initWorktrees } from "./lib/bootstrap/init-worktrees";
  import { confirmAndCloseWorkspace } from "./lib/services/worktree-service";
  import { initGitStatus } from "./lib/bootstrap/init-git-status";
  import { initPreview } from "./lib/bootstrap/init-preview";
  import { initAgentDetectionBootstrap } from "./lib/bootstrap/init-agent-detection";
  import { initAgentStatus } from "./lib/bootstrap/init-agent-status";
  import { initAttentionApi } from "./lib/services/attention-api";
  import { initBranchLifecycle } from "./lib/services/branch-lifecycle";
  import { startPrStatePoller } from "./lib/services/pr-state-poller";
  import { startBranchCommitsPoller } from "./lib/services/branch-commits-poller";
  import { initCoreExtensionAPI } from "./lib/bootstrap/init-core-extension-api";
  import {
    initWorkspaces,
    recheckWorkspaceIsGit,
  } from "./lib/bootstrap/init-workspaces";
  import {
    restoreWorkspaces,
    markRestored,
    type CliArgs,
  } from "./lib/bootstrap/restore-workspaces";
  import {
    reconcilePrimaryWorkspaces,
    validateWorkspaceRootPaths,
  } from "./lib/services/workspace-service";

  // Services
  import {
    createWorkspaceFromDef,
    switchWorkspace,
    switchToLastWorkspace,
    closeAllWorkspaces,
    saveCurrentWorkspace,
    persistWorkspaces,
    schedulePersist,
  } from "./lib/services/workspace-runtime-service";
  import {
    splitPane,
    closePane,
    focusPane,
    splitFromSidebar,
    togglePaneZoom,
  } from "./lib/services/pane-service";
  import {
    selectSurface,
    closeSurfaceById,
    newSurface,
    nextSurface,
    prevSurface,
    closeActiveSurface,
    openRegistrySurfaceInPane,
    openRegistrySurfaceInPaneById,
    newSurfaceWithCommand,
    newSurfaceFromSidebar,
  } from "./lib/services/surface-service";
  import {
    registerCommands,
    runCommandById,
  } from "./lib/services/command-registry";
  import { registerWorkspaceAction } from "./lib/services/workspace-action-registry";
  import { initMcpServer } from "./lib/services/mcp-server";
  import { handleAppKeydown } from "./lib/services/keyboard-shortcuts";
  import { initShortcutHints } from "./lib/stores/shortcut-hints";
  import {
    restoreWindowBounds,
    saveWindowBounds,
  } from "./lib/services/window-bounds-service";
  import {
    restoreSidebarVisible,
    persistSidebarVisibleChanges,
    restoreBannerCollapsed,
    persistBannerCollapsedChanges,
  } from "./lib/services/sidebar-persistence-service";
  import { confirmQuit } from "./lib/services/quit-confirmation-service";

  // Components
  import Sidebar from "./lib/components/Sidebar.svelte";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import WorkspaceView from "./lib/components/WorkspaceView.svelte";
  import EmptySurface from "./lib/components/EmptySurface.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import FindBar from "./lib/components/FindBar.svelte";
  import ContextMenu from "./lib/components/ContextMenu.svelte";
  import InputPrompt from "./lib/components/InputPrompt.svelte";
  import ConfirmPrompt from "./lib/components/ConfirmPrompt.svelte";
  import FormPrompt from "./lib/components/FormPrompt.svelte";
  import RestoreCommandsOverlay from "./lib/components/RestoreCommandsOverlay.svelte";
  import ShortcutReference from "./lib/components/ShortcutReference.svelte";
  import KeyboardIcon from "./lib/icons/KeyboardIcon.svelte";
  import WorkspaceSwitcher from "./lib/components/WorkspaceSwitcher.svelte";
  import WorkspaceCreateOverlay from "./lib/components/WorkspaceCreateOverlay.svelte";
  import { surfaceTypeStore } from "./lib/services/surface-type-registry";
  import {
    registerGlobalSurface,
    spawnOrNavigate,
  } from "./lib/services/global-surface-service";
  import SettingsPanel from "./lib/components/SettingsPanel.svelte";
  import GearIcon from "./lib/icons/GearIcon.svelte";
  import WorkspaceOverviewDashboard from "./lib/components/WorkspaceOverviewDashboard.svelte";
  import GridIcon from "./lib/icons/GridIcon.svelte";
  import type { Component } from "svelte";

  const TOAST_DURATION_MS = 5000;

  let sidebarComponent: Sidebar;
  let findBarComponent: FindBar;

  // Module-scoped within this component instance; gates the bulk
  // "Restore commands?" dialog so it only fires once per launch even if
  // workspaces are re-restored later (rare, but possible via dev reload).
  let restoreCommandsOverlayShown = false;
  let showRestoreCommandsOverlay = false;

  // Workspace/branch switcher overlay (⌘O / Ctrl+O). Two-way bound so the
  // component can self-close on Escape / confirm / backdrop click.
  let workspaceSwitcherOpen = false;

  // ---- Extension error toast ----
  let activeToasts: {
    id: string;
    name: string;
    timerId: ReturnType<typeof setTimeout>;
  }[] = [];
  const shownErrorIds = new Set<string>();

  // Close the primary sidebar when the last workspace is removed.
  let _prevWorkspaceCount = 0;
  $: {
    const count = $workspaces.length;
    if (_prevWorkspaceCount > 0 && count === 0) {
      sidebarVisible.set(false);
    }
    _prevWorkspaceCount = count;
  }

  $: {
    for (const err of $extensionErrorStore) {
      if (!shownErrorIds.has(err.id)) {
        shownErrorIds.add(err.id);
        const timerId = setTimeout(() => {
          activeToasts = activeToasts.filter((t) => t.id !== err.id);
        }, TOAST_DURATION_MS);
        activeToasts = [...activeToasts, { id: err.id, name: err.id, timerId }];
      }
    }
  }

  function dismissToast(id: string) {
    const toast = activeToasts.find((t) => t.id === id);
    if (toast) clearTimeout(toast.timerId);
    activeToasts = activeToasts.filter((t) => t.id !== id);
    void spawnOrNavigate("gnar-term:settings");
  }

  // ---- Theme ----

  function applyTheme(id: string) {
    const previousId = get(theme.id);
    theme.set(id);
    forEachTerminalSurface((s) => {
      s.terminal.options.theme = $xtermTheme;
    });
    eventBus.emit({ type: "theme:changed", id, previousId });
    void saveConfig({ theme: id });
  }

  // ---- Notification navigation ----

  /**
   * Jump to the next surface with an unread notification. Search order is
   * deterministic — start at the active workspace's active pane and walk
   * forward through workspaces / panes / surfaces, wrapping around. The
   * landed surface is marked read; other unreads stay until visited.
   */
  function jumpToNextUnread(): void {
    const ws = $workspaces;
    if (ws.length === 0) return;
    const startWsIdx = Math.max(0, $activeWorkspaceIdx);
    const len = ws.length;
    for (let i = 0; i < len; i++) {
      const wsIdx = (startWsIdx + i) % len;
      const w = ws[wsIdx];
      if (!w) continue;
      const panes = getAllPanes(w.paneLayout);
      for (const p of panes) {
        const surface = p.surfaces.find((s) => s.hasUnread);
        if (!surface) continue;
        if (wsIdx !== $activeWorkspaceIdx) switchWorkspace(wsIdx);
        focusPane(p.id);
        selectSurface(p.id, surface.id);
        workspaces.update((wsList) => {
          surface.hasUnread = false;
          surface.notification = undefined;
          return [...wsList];
        });
        return;
      }
    }
  }

  // ---- Command palette (register into command registry) ----

  $: registerCommands([
    {
      id: "core.new-workspace",
      title: "New Workspace",
      shortcut: `${modLabel}N`,
      action: () => runCommandById("create-workspace"),
      source: "core",
    },
    {
      id: "core.new-surface",
      title: "New Surface (Tab)",
      shortcut: `${shiftModLabel}T`,
      action: () => newSurfaceFromSidebar(),
      source: "core",
    },
    {
      id: "core.split-right",
      title: "Split Right",
      shortcut: isMac ? `${modLabel}D` : `${shiftModLabel}D`,
      action: () => splitFromSidebar("horizontal"),
      source: "core",
    },
    {
      // On mac Split Right uses bare ⌘D so ⇧D is free; on Linux/Windows
      // Split Right already uses Ctrl+Shift+D, so use Ctrl+Shift+E here.
      id: "core.split-down",
      title: "Split Down",
      shortcut: isMac ? `${shiftModLabel}D` : `${shiftModLabel}E`,
      action: () => splitFromSidebar("vertical"),
      source: "core",
    },
    {
      id: "core.close-surface",
      title: "Close Surface",
      shortcut: isMac ? `${modLabel}W` : `${shiftModLabel}W`,
      action: () => closeActiveSurface(),
      source: "core",
    },
    {
      // Avoid colliding with Close Surface's Ctrl+Shift+W on Linux/Windows.
      id: "core.close-workspace",
      title: "Close Workspace",
      shortcut: isMac ? `${shiftModLabel}W` : `${shiftModLabel}Q`,
      action: () => {
        void (async () => {
          const ws = $workspaces[$activeWorkspaceIdx];
          if (!ws) return;
          await confirmAndCloseWorkspace(ws, $activeWorkspaceIdx);
        })();
      },
      source: "core",
    },
    {
      // Palette-only escape hatch for nuking stale state — e.g. orphaned
      // workspaces left behind by workspace deletion on older builds.
      // Intentionally no shortcut (destructive, rarely wanted).
      id: "core.close-all-workspaces",
      title: "Close All Workspaces",
      action: () => void closeAllWorkspaces(),
      source: "core",
    },
    {
      id: "core.next-surface",
      title: "Next Surface",
      shortcut: `${shiftModLabel}]`,
      action: () => nextSurface(),
      source: "core",
    },
    {
      id: "core.prev-surface",
      title: "Previous Surface",
      shortcut: `${shiftModLabel}[`,
      action: () => prevSurface(),
      source: "core",
    },
    {
      id: "core.toggle-sidebar",
      title: "Toggle Sidebar",
      shortcut: `${shiftModLabel}B`,
      action: () => sidebarVisible.update((v) => !v),
      source: "core",
    },
    {
      id: "core.toggle-find-bar",
      title: "Toggle Find Bar",
      shortcut: `${shiftModLabel}F`,
      action: () => findBarVisible.update((v) => !v),
      source: "core",
    },
    {
      id: "core.open-settings",
      title: "Open Settings",
      shortcut: isMac ? "⌘," : "Ctrl+,",
      action: () => void spawnOrNavigate("gnar-term:settings"),
      source: "core",
    },
    {
      // Shortcut intentionally mac-only — see ShortcutReference.svelte's
      // "Keyboard Shortcuts" row for the same Linux/Win blank.
      id: "core.show-keyboard-shortcuts",
      title: "Show Keyboard Shortcuts",
      shortcut: isMac ? "⌘/" : undefined,
      action: () => void spawnOrNavigate("gnar-term:keyboard-shortcuts"),
      source: "core",
    },
    {
      id: "core.workspace-switcher",
      title: "Switch Workspace...",
      shortcut: isMac ? "⌘O" : "Ctrl+O",
      action: () => (workspaceSwitcherOpen = true),
      source: "core",
    },
    {
      id: "core.clear-scrollback",
      title: "Clear Scrollback",
      shortcut: isMac ? `${modLabel}K` : `${shiftModLabel}K`,
      action: () => {
        const s = $activeSurface;
        if (s && isTerminalSurface(s)) s.terminal.clear();
      },
      source: "core",
    },
    {
      id: "core.jump-to-unread",
      title: "Jump to Next Unread Notification",
      shortcut: `${shiftModLabel}U`,
      action: () => jumpToNextUnread(),
      source: "core",
    },
    {
      id: "core.toggle-pane-zoom",
      title: "Toggle Pane Zoom",
      shortcut: `${shiftModLabel}Enter`,
      action: () => {
        const s = $activeSurface;
        if (s) togglePaneZoom(s.id);
      },
      source: "core",
    },
    {
      id: "core.increase-font-size",
      title: "Increase Font Size",
      shortcut: isMac ? `${modLabel}=` : `Ctrl+Shift+=`,
      action: () => adjustFontSize(1),
      source: "core",
    },
    {
      id: "core.decrease-font-size",
      title: "Decrease Font Size",
      shortcut: isMac ? `${modLabel}-` : `Ctrl+Shift+-`,
      action: () => adjustFontSize(-1),
      source: "core",
    },
    {
      id: "core.reset-font-size",
      title: "Reset Font Size",
      shortcut: isMac ? `${modLabel}0` : `Ctrl+Shift+0`,
      action: () => resetFontSize(),
      source: "core",
    },
    ...$workspaces.map((ws, i) => ({
      id: `core.switch-workspace-${ws.id}`,
      title: `Switch to: ${ws.name}`,
      shortcut: i < 9 ? `${modLabel}${i + 1}` : undefined,
      action: () => switchWorkspace(i),
      source: "core",
    })),
    {
      id: "core.last-workspace",
      title: "Switch to Last Workspace",
      shortcut: isMac ? "⌘`" : "Ctrl+Shift+`",
      action: () => switchToLastWorkspace(),
      source: "core",
    },
    {
      id: "core.save-workspace",
      title: "Save Current Workspace...",
      action: () => saveCurrentWorkspace(),
      source: "core",
    },
    ...getWorkspaceCommands().map((cmd) => ({
      id: `core.workspace-cmd-${cmd.name}`,
      title: cmd.name,
      action: () => {
        if (cmd.workspace) void createWorkspaceFromDef(cmd.workspace);
      },
      source: "core",
    })),
    ...Object.entries(themes).map(([id, t]) => ({
      id: `core.theme-${id}`,
      title: `Theme: ${t.name}`,
      action: () => applyTheme(id),
      source: "core",
    })),
    {
      id: "core.check-for-updates",
      title: "Check for Updates",
      action: async () => {
        try {
          const update = await check();
          if (update) {
            const confirmed = await ask(
              `Update ${update.version} is available. Install now and restart GnarTerm?`,
              { title: "Update available", kind: "info" },
            );
            if (confirmed) {
              await update.downloadAndInstall();
              await relaunch();
            }
          } else {
            await message("GnarTerm is up to date.", {
              title: "No updates",
              kind: "info",
            });
          }
        } catch (err) {
          console.error("[updater] Failed to check for updates:", err);
          await message(
            `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
            { title: "Update check failed", kind: "error" },
          );
        }
      },
      source: "core",
    },
    {
      id: "core.view-extensions",
      title: "Extensions: View Installed",
      action: () => void spawnOrNavigate("gnar-term:settings"),
      source: "core",
    },
    {
      id: "core.close-pane",
      title: "Close Pane",
      shortcut: `${shiftModLabel}X`,
      action: () => {
        const pane = get(activePane);
        if (pane) closePane(pane.id);
      },
      source: "core",
    },
    {
      // No shortcut — keyboard binding in keyboard-shortcuts.ts (⇧⌘R / Ctrl+Shift+R)
      // avoids double-fire with the hardcoded handler. Palette discoverability only.
      id: "core.rename-workspace",
      title: "Rename Workspace",
      action: () => sidebarComponent?.startRename($activeWorkspaceIdx),
      source: "core",
    },
    ...$extensionStore
      .filter(
        (ext) =>
          ext.manifest.contributes?.settings &&
          Object.keys(ext.manifest.contributes.settings.fields).length > 0,
      )
      .map((ext) => ({
        id: `core.ext-settings-${ext.manifest.id}`,
        title: `Settings: ${ext.manifest.name}`,
        action: () => void spawnOrNavigate("gnar-term:settings"),
        source: "core",
      })),
  ]);

  // ---- Open file in $EDITOR ----

  async function openInEditor(filePath: string) {
    const pane = $activePane;
    if (!pane) return;
    // Reject paths with control characters (newlines, tabs, etc.) that could
    // break out of the shell command or cause unexpected behavior
    if (/[\x00-\x1f\x7f]/.test(filePath)) {
      console.warn(
        "[openInEditor] Rejected path with control characters:",
        filePath,
      );
      return;
    }
    const escaped = filePath.replace(/'/g, "'\\''");
    await newSurfaceWithCommand(pane.id, `\${EDITOR:-vi} '${escaped}'`);
  }

  // ---- Pending action consumer ----

  $: if ($pendingAction) {
    const action = $pendingAction;
    pendingAction.set(null);
    if (action.type === "split-right") {
      splitFromSidebar("horizontal");
    } else if (action.type === "split-down") {
      splitFromSidebar("vertical");
    } else if (action.type === "open-in-editor") {
      void openInEditor(action.filePath);
    } else if (action.type === "open-surface") {
      openRegistrySurfaceInPane(
        action.surfaceTypeId,
        action.title,
        action.props,
      );
    } else if (action.type === "switch-workspace") {
      const idx = $workspaces.findIndex((w) => w.id === action.workspaceId);
      if (idx >= 0) switchWorkspace(idx);
    } else if (action.type === "close-workspace") {
      const idx = $workspaces.findIndex((w) => w.id === action.workspaceId);
      const ws = $workspaces[idx];
      if (idx >= 0 && ws) void confirmAndCloseWorkspace(ws, idx);
    }
  }

  // ---- Keyboard shortcuts ----

  function handleKeydown(e: KeyboardEvent) {
    handleAppKeydown(e, {
      startRenameActiveWorkspace: () =>
        sidebarComponent?.startRename($activeWorkspaceIdx),
      findNext: () => findBarComponent?.findNext(),
      findPrev: () => findBarComponent?.findPrev(),
    });
  }

  // ---- Initialization ----
  let _cleanupShortcutHints: (() => void) | null = null;
  let _cleanupPointerWindow: (() => void) | null = null;
  let _cleanupVisibilityRecover: (() => void) | null = null;
  let _cleanupDragDropRouter: (() => void) | null = null;
  let _rootPathSweepInterval: number | null = null;
  let _gitRecheckInterval: ReturnType<typeof setInterval> | null = null;
  let _cleanupPrPoller: (() => void) | null = null;
  let _cleanupCommitsPoller: (() => void) | null = null;
  onDestroy(() => {
    _cleanupShortcutHints?.();
    _cleanupVisibilityRecover?.();
    _cleanupDragDropRouter?.();
    _cleanupPrPoller?.();
    _cleanupCommitsPoller?.();
    _cleanupPointerWindow?.();
    if (_rootPathSweepInterval !== null)
      window.clearInterval(_rootPathSweepInterval);
    if (_gitRecheckInterval !== null) clearInterval(_gitRecheckInterval);
  });

  onMount(async () => {
    _cleanupShortcutHints = initShortcutHints();
    _cleanupPointerWindow = installPointerWindowListeners();
    initDragDropPaneRouter()
      .then((dispose) => {
        _cleanupDragDropRouter = dispose;
      })
      .catch((e) => console.warn("[drag-drop] init failed:", e));

    // OS sleep/resume can return the GPU context with a corrupted texture
    // atlas — visible as garbled multi-color glyphs that "fix themselves"
    // when the user resizes the window (resize is the only path that
    // currently invalidates the atlas). Clear on every visibility regain.
    const onVisibility = () => {
      if (document.visibilityState === "visible") clearAllTerminalAtlases();
    };
    document.addEventListener("visibilitychange", onVisibility);
    _cleanupVisibilityRecover = () =>
      document.removeEventListener("visibilitychange", onVisibility);
    await fontReady;
    void setupListeners();
    startCwdPolling();
    registerCwdChangeHook(schedulePersist);
    initMcpServer().catch((err) => {
      // Surface frontend-side init failures through the extension error
      // toast rather than a silent console.warn.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[mcp] init failed:", err);
      reportExtensionError("mcp", `MCP bridge unavailable: ${msg}`);
    });

    // Backend emits this when the Rust MCP bridge fails to spawn
    // (currently: Windows — UDS not implemented yet). Used to be a silent
    // backend log, which left Windows users with an invisible dead
    // feature. Now surfaces to the same toast as any other extension error.
    void listen<string>("mcp-bridge-failed", (event) => {
      reportExtensionError("mcp", `MCP bridge unavailable: ${event.payload}`);
    });

    // Load config before extensions so getSetting() works in onActivate
    const cliArgs = await invoke<CliArgs>("get_cli_args");
    const config = await loadConfig(cliArgs.config || undefined);
    if (config.userThemes) {
      for (const [id, t] of Object.entries(config.userThemes)) {
        try {
          registerTheme("user", id, t);
        } catch (err) {
          console.warn(`[theme] Failed to register user theme "${id}":`, err);
        }
      }
    }
    if (config.theme) {
      theme.set(config.theme);
    }
    setFontSizeFromConfig(config.fontSize);

    // After the config is applied, subscribe to font-size changes so any
    // subsequent user-triggered zoom propagates to every live terminal,
    // refits the pty, and persists. The first emission is the loaded
    // value — apply but don't persist (prevents a write-on-startup).
    let fontSizeInitialEmission = true;
    fontSize.subscribe((size) => {
      forEachTerminalSurface((s) => {
        s.terminal.options.fontSize = size;
        try {
          s.fitAddon?.fit();
        } catch {
          // fit throws if the terminal isn't opened yet; ignored.
        }
        try {
          s.terminal.clearTextureAtlas?.();
        } catch {
          // No-op if renderer doesn't support atlas clearing
        }
      });
      if (fontSizeInitialEmission) {
        fontSizeInitialEmission = false;
        return;
      }
      void saveConfig({ fontSize: size });
    });

    // Register the shared "core" ExtensionAPI before any core
    // subsystem contributes a UI renderer — ExtensionWrapper uses this
    // to inject `api.theme` / `api.invoke` into components mounted
    // under source="core".
    initCoreExtensionAPI();

    // Wire core worktree handling before extensions register so any
    // extension subscribing to "worktree:merged" finds the emitter live.
    initWorktrees();
    initGitStatus();
    initPreview();
    initAgentDetectionBootstrap();
    // Attention API + BranchLifecycle subscribe to detection's stores —
    // start them after detection so initial fan-out lands on live subs.
    initAttentionApi();
    initBranchLifecycle();
    // Per-Workspace agent visibility (subtitle + child rows) ships with
    // core — registered after branch-lifecycle so the subtitle's
    // lifecycle pill can read from a live store on first render.
    initAgentStatus();
    _cleanupPrPoller = startPrStatePoller();
    _cleanupCommitsPoller = startBranchCommitsPoller();

    // Workspaces (formerly the project-scope extension) —
    // registered from core so the root-row renderer, commands, and
    // Dashboard contribution are available before extensions activate.
    await initWorkspaces();

    // Register the core settings global surface before extensions so the
    // gear button is wired before any extension activates.
    registerGlobalSurface({
      id: "gnar-term:settings",
      label: "Settings",
      icon: GearIcon as unknown as Component,
      component: SettingsPanel as unknown as Component,
      accentColor: "#8998A8",
    });

    // Register the Workspaces overview global surface.
    registerGlobalSurface({
      id: "gnar-term:workspace-overview",
      label: "Workspaces",
      icon: GridIcon as unknown as Component,
      component: WorkspaceOverviewDashboard as unknown as Component,
    });

    // Register the keyboard-shortcuts reference global surface (⌘/).
    registerGlobalSurface({
      id: "gnar-term:keyboard-shortcuts",
      label: "Keyboard Shortcuts",
      icon: KeyboardIcon as unknown as Component,
      component: ShortcutReference as unknown as Component,
      accentColor: "#7FB8E6",
    });

    // Register included extensions. Only activate if explicitly enabled
    // in config — a fresh install starts with no extensions active
    // (opt-in model). Errors per extension are isolated.
    await registerIncludedExtensions(config);

    // Load external extensions from config (after config is loaded)
    await loadExternalExtensions();

    // Register core workspace actions (after extensions so they appear first)
    registerWorkspaceAction({
      id: "core:new-workspace",
      label: "New Workspace",
      icon: "plus",
      shortcut: `${shiftModLabel}N`,
      source: "core",
      handler: (_ctx) => {
        runCommandById("create-workspace");
      },
    });

    await restoreWorkspaces(cliArgs, config);
    // Signal that workspaces are in the store so deferred work (the
    // agentic extension's provision loop) can safely read and write the
    // workspaces store without racing restore.
    markRestored();

    // Re-apply the persisted window bounds. `restoreWorkspaces` calls
    // loadState() which populates the in-memory AppState — read it via
    // getState() so we don't need to thread the value back through the
    // bootstrap signature. Best-effort; failures are logged and ignored.
    void restoreWindowBounds(getState().windowBounds, getCurrentWindow());
    // Apply the persisted sidebar expanded/collapsed state, then start
    // persisting subsequent toggles. Must run after restore so the first
    // emission (the just-restored value) is the one we skip.
    restoreSidebarVisible(getState());
    persistSidebarVisibleChanges();
    restoreBannerCollapsed(getState());
    persistBannerCollapsedChanges();
    // Promote standalone runtime workspaces to Roots and rebuild each
    // Workspace's branchedWorkspaceIds from rootWorkspaceId now that the
    // workspaces store is populated.
    await reconcilePrimaryWorkspaces();
    // Stamp `pathMissing` on workspaces whose root directory has gone
    // missing across sessions. Runs in the background — a slow FS
    // probe shouldn't block the rest of bootstrap.
    void validateWorkspaceRootPaths();

    // Rehydrate the persisted root-row order so drag-sorted layouts
    // survive across restarts. Entities are all registered by this
    // point — pseudo-workspaces and any pinned extension rows have been
    // appended during activation; restoreWorkspaces appended workspace
    // rows. Bootstrap re-sorts to match the persisted order and drops
    // entries whose referent is gone.
    const currentOrder = get(rootRowOrder);
    const passthroughRows = currentOrder.filter((r) => r.kind !== "workspace");
    const rootWorkspaceRows: RootRow[] = get(workspaces)
      .filter((w) => typeof w.rootWorkspaceId !== "string")
      .map((w) => ({ kind: "workspace", id: w.id }));
    bootstrapRootRowOrder([...rootWorkspaceRows, ...passthroughRows]);

    if (!restoreCommandsOverlayShown) {
      const hasPending = $workspaces.some((ws) =>
        getAllSurfaces(ws).some(
          (s) => isTerminalSurface(s) && s.pendingRestoreCommand,
        ),
      );
      if (hasPending) {
        restoreCommandsOverlayShown = true;
        showRestoreCommandsOverlay = true;
      }
    }

    void listen<string>("menu-theme", (event) => {
      applyTheme(event.payload.replace("theme-", ""));
    });

    await listen("menu-cmd-palette", () => {
      commandPaletteOpen.update((v) => !v);
    });

    await listen("menu-close-tab", () => {
      closeActiveSurface();
    });

    await listen("menu-paste", () => {
      void handleMenuPaste();
    });

    // Track fullscreen state for layout adjustments (e.g. traffic light padding)
    const appWindow = getCurrentWindow();
    isFullscreen.set(await appWindow.isFullscreen());
    void appWindow.onResized(async () => {
      isFullscreen.set(await appWindow.isFullscreen());
    });

    void appWindow.onFocusChanged((focused) => {
      if (!focused) return;
      for (const ws of get(workspaces)) {
        for (const s of getAllSurfaces(ws)) {
          if (isTerminalSurface(s) && s.opened) {
            try {
              s.fitAddon.fit();
            } catch {
              // detached terminal — ignore
            }
          }
        }
      }
      // Re-sweep workspace root paths on focus — picks up directories
      // that were renamed in Finder/`mv` while gnar-term was unfocused.
      void validateWorkspaceRootPaths();
      // The user may have run `git init` / `git clone` (or removed a
      // `.git`) in a terminal while the window was blurred. Re-check
      // every root workspace so the sidebar banner reflects reality
      // when focus returns.
      for (const ws of get(workspaces)) {
        if (ws.rootWorkspaceId === undefined && !ws.isDashboard) {
          void recheckWorkspaceIsGit(ws.id);
        }
      }
    });

    // Periodic sweep — catches renames that happen while gnar-term is
    // focused but idle. 60s is a pragmatic floor; the sweep is cheap
    // (one `stat` per workspace). Cleared in the top-level onDestroy.
    _rootPathSweepInterval = window.setInterval(() => {
      void validateWorkspaceRootPaths();
    }, 60_000);

    // Polling backstop: focus / activation events miss the common
    // case of running `git init` in the active workspace's terminal
    // without leaving the window. A 5s `is_git_repo` stat against
    // the active root keeps the sidebar in sync without watching
    // the filesystem. updateWorkspace is only called on diff, so
    // steady-state polling is a no-op.
    _gitRecheckInterval = setInterval(() => {
      const ws = get(activeWorkspace);
      if (!ws) return;
      const rootId = ws.rootWorkspaceId ?? ws.id;
      void recheckWorkspaceIsGit(rootId);
    }, 5000);

    // Flush workspace and extension state to disk before the window closes.
    // Tauri v2: the window closes synchronously unless we preventDefault the
    // event first. Without this, the async flush races the process teardown
    // and workspace membership / debounced writes can be lost on quit.
    void appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      const confirmed = await confirmQuit();
      if (!confirmed) return;
      // Snapshot window bounds before destroy so the next launch lands
      // where the user left off. Best-effort; saveWindowBounds swallows
      // its own errors.
      await saveWindowBounds(appWindow);
      // Run all flushes defensively so one failure can't strand the others.
      const results = await Promise.allSettled([
        persistWorkspaces(),
        flushAllExtensionState(),
      ]);
      for (const r of results) {
        if (r.status === "rejected") {
          console.error("[shutdown] flush failed:", r.reason);
        }
      }
      try {
        await appWindow.destroy();
      } catch (err) {
        console.error("[shutdown] destroy failed:", err);
      }
    });
  });
</script>

<svelte:window on:keydown={handleKeydown} />

{#if activeToasts.length > 0}
  <div class="extension-toast-container">
    {#each activeToasts as toast (toast.id)}
      <button class="extension-toast" on:click={() => dismissToast(toast.id)}>
        Extension "{toast.name}" failed to load
      </button>
    {/each}
  </div>
{/if}

<div
  id="app"
  style="
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    --theme-bg: {$theme.bg};
    --theme-bg-surface: {$theme.bgSurface};
    --theme-bg-highlight: {$theme.bgHighlight};
    --theme-border: {$theme.border};
    --theme-border-active: {$theme.borderActive};
    --theme-fg: {$theme.fg};
    --theme-fg-dim: {$theme.fgDim};
    --theme-accent: {$theme.accent};
    --theme-notify: {$theme.notify};
    --theme-notify-glow: {$theme.notifyGlow};
    --theme-sidebar-bg: {$theme.sidebarBg};
    --theme-tab-bar-bg: {$theme.tabBarBg};
    --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px;
    --title-bar-height: 38px;
    --tab-bar-height: 28px;
  "
>
  <!-- When the sidebar is collapsed, the TitleBar takes the full window
       width and the rail-only sidebar drops below it on the left. This
       lets the macOS traffic-light cluster overlay the TitleBar (which
       already pads them out via leftPadding) without competing with the
       sidebar for the top-left of the window. When expanded, the
       TitleBar stays inside the right column so the sidebar keeps its
       own top chrome region. -->
  {#if !$sidebarVisible}
    <TitleBar />
  {/if}

  <!-- Row container is position: relative so the collapsed sidebar can
       overlay the main column. When collapsed, the sidebar floats on top
       of the terminal canvas and the main column gains a left padding so
       its content scoots out from under the rail. This eliminates the
       flex-sibling boundary that otherwise reads as a vertical seam at
       the rail/terminal edge. Expanded mode keeps the historical flex
       layout untouched. -->
  <div
    style="
      flex: 1; display: flex; flex-direction: row;
      min-height: 0; min-width: 0; overflow: hidden;
      position: relative;
    "
  >
    <Sidebar bind:this={sidebarComponent} />

    <div
      style="
        flex: 1; display: flex; flex-direction: column;
        background: {$theme.bg}; min-width: 0; min-height: 0; overflow: hidden;
        {$sidebarVisible ? '' : 'padding-left: 17px;'}
      "
    >
      {#if $sidebarVisible}
        <TitleBar />
      {/if}

      <div
        id="terminal-area"
        style="flex: 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; position: relative;"
      >
        {#each $workspaces as ws, i (ws.id)}
          <WorkspaceView
            workspace={ws}
            visible={i === $activeWorkspaceIdx &&
              $activePseudoWorkspaceId === null}
            onSelectSurface={selectSurface}
            onCloseSurface={closeSurfaceById}
            onNewSurface={newSurface}
            onSelectSurfaceType={(paneId, typeId) => {
              const typeDef = $surfaceTypeStore.find((t) => t.id === typeId);
              if (typeDef) {
                openRegistrySurfaceInPaneById(paneId, typeId, typeDef.label);
              }
            }}
            onSplitRight={(paneId) => splitPane(paneId, "horizontal")}
            onSplitDown={(paneId) => splitPane(paneId, "vertical")}
            onClosePane={closePane}
            onFocusPane={focusPane}
          />
        {/each}

        {#each $pseudoWorkspaceStore as pseudo (pseudo.id)}
          {@const pseudoApi = getExtensionApiById(pseudo.source)}
          <div
            data-pseudo-workspace-view={pseudo.id}
            style="
              flex: 1; min-height: 0; min-width: 0; display: {pseudo.id ===
            $activePseudoWorkspaceId
              ? 'flex'
              : 'none'};
              flex-direction: column;
            "
          >
            {#if pseudoApi}
              <ExtensionWrapper api={pseudoApi} component={pseudo.render} />
            {:else}
              <svelte:component
                this={pseudo.render as import("svelte").Component}
              />
            {/if}
          </div>
        {/each}

        {#if ($workspaces.length === 0 || $activeWorkspaceIdx < 0) && $activePseudoWorkspaceId === null}
          <EmptySurface />
        {/if}

        <FindBar bind:this={findBarComponent} />
      </div>
    </div>
  </div>
</div>

<CommandPalette />
<ContextMenu />
<InputPrompt />
<ConfirmPrompt />
<FormPrompt />
<WorkspaceCreateOverlay />
{#if showRestoreCommandsOverlay}
  <RestoreCommandsOverlay
    onClose={() => (showRestoreCommandsOverlay = false)}
  />
{/if}
<WorkspaceSwitcher bind:open={workspaceSwitcherOpen} />

<style>
  :global(:focus-visible) {
    outline: 2px solid var(--theme-accent, #7c6aff);
    outline-offset: 2px;
    border-radius: 2px;
  }

  /* xterm.js v6 ships an unstyled `.xterm-slider` thumb (its CSS
     depends on a VSCode scrollbar-slider var that we don't set), which
     leaves an empty rail with no visible handle in terminal panes.
     Paint the thumb with the theme's dimmed-foreground and brighten on
     hover/active so it's discoverable across light and dark themes. */
  :global(.xterm-slider) {
    background: var(--theme-fg-dim, rgba(255, 255, 255, 0.25));
    border-radius: 4px;
    opacity: 0.5;
    transition: opacity 0.15s;
  }
  :global(.xterm-scrollable-element:hover .xterm-slider) {
    opacity: 0.8;
  }
  :global(.xterm-slider:hover),
  :global(.xterm-slider.active) {
    opacity: 1;
  }

  :global(.no-default-outline) {
    outline: none;
  }

  :global(.no-default-outline:focus-visible) {
    outline: 2px solid var(--theme-accent, #7c6aff);
    outline-offset: 2px;
  }

  .extension-toast-container {
    position: fixed;
    top: 32px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }

  .extension-toast {
    pointer-events: auto;
    background: rgba(200, 50, 50, 0.9);
    color: #f0f0f0;
    border: 1px solid rgba(255, 80, 80, 0.6);
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    transition: opacity 0.2s ease;
  }

  .extension-toast:hover {
    background: rgba(220, 60, 60, 0.95);
  }
</style>
