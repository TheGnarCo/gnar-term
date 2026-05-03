<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { theme, themes, xtermTheme } from "./lib/stores/theme";
  import { fontSize, setFontSizeFromConfig } from "./lib/stores/font-size";
  import {
    isFullscreen,
    primarySidebarVisible,
    commandPaletteOpen,
    findBarVisible,
    pendingAction,
    showInputPrompt,
  } from "./lib/stores/ui";
  import {
    nestedWorkspaces,
    activeNestedWorkspaceIdx,
    activePane,
    activeSurface,
    activePseudoWorkspaceId,
  } from "./lib/stores/nested-workspace";
  import { pseudoWorkspaceStore } from "./lib/services/pseudo-workspace-registry";
  import {
    rootRowOrder,
    bootstrapRootRowOrder,
  } from "./lib/stores/root-row-order";
  import { claimedWorkspaceIds } from "./lib/services/claimed-workspace-registry";
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
  } from "./lib/terminal-service";
  import { getAllPanes, getAllSurfaces, isTerminalSurface } from "./lib/types";
  import { forEachTerminalSurface } from "./lib/services/service-helpers";
  import { check } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { eventBus } from "./lib/services/event-bus";

  // Extension lifecycle
  import {
    extensionStore,
    extensionErrorStore,
    reportExtensionError,
    flushAllExtensionState,
    ensureProviderAndThen,
  } from "./lib/services/extension-loader";
  import { loadExternalExtensions } from "./lib/services/extension-management";
  import { registerIncludedExtensions } from "./lib/bootstrap/register-included-extensions";
  import { initWorktrees } from "./lib/bootstrap/init-worktrees";
  import { confirmAndCloseWorkspace } from "./lib/services/worktree-service";
  import { initGitStatus } from "./lib/bootstrap/init-git-status";
  import { initPreview } from "./lib/bootstrap/init-preview";
  import { initAgentDetectionBootstrap } from "./lib/bootstrap/init-agent-detection";
  import { initCoreExtensionAPI } from "./lib/bootstrap/init-core-extension-api";
  import { initWorkspaces } from "./lib/bootstrap/init-workspaces";
  import { flushWorkspaces } from "./lib/stores/workspaces";
  import {
    restoreWorkspaces,
    markRestored,
    type CliArgs,
  } from "./lib/bootstrap/restore-workspaces";
  import {
    reconcileWorkspaceDashboards,
    reconcilePrimaryWorkspaces,
    setupPrimaryWorkspaceAutoRecreation,
  } from "./lib/services/workspace-service";

  // Services
  import {
    createNestedWorkspace,
    createNestedWorkspaceFromDef,
    switchNestedWorkspace,
    closeAllWorkspaces,
    renameNestedWorkspace,
    saveCurrentWorkspace,
    persistWorkspaces,
    schedulePersist,
  } from "./lib/services/nested-workspace-service";
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
    openExtensionSurfaceInPane,
    openExtensionSurfaceInPaneById,
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
  import { confirmQuit } from "./lib/services/quit-confirmation-service";

  // Components
  import PrimarySidebar from "./lib/components/PrimarySidebar.svelte";
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
  import WorkspaceSwitcher from "./lib/components/WorkspaceSwitcher.svelte";
  import WorkspaceCreateOverlay from "./lib/components/WorkspaceCreateOverlay.svelte";
  import { surfaceTypeStore } from "./lib/services/surface-type-registry";
  import {
    registerDashboardWorkspaceType,
    spawnOrNavigate,
  } from "./lib/services/dashboard-workspace-service";
  import SettingsPanel from "./lib/components/SettingsPanel.svelte";
  import GearIcon from "./lib/icons/GearIcon.svelte";
  import type { Component } from "svelte";

  const TOAST_DURATION_MS = 5000;

  let sidebarComponent: PrimarySidebar;
  let findBarComponent: FindBar;

  // Module-scoped within this component instance; gates the bulk
  // "Restore commands?" dialog so it only fires once per launch even if
  // nestedWorkspaces are re-restored later (rare, but possible via dev reload).
  let restoreCommandsOverlayShown = false;
  let showRestoreCommandsOverlay = false;

  // Shortcut reference overlay (⌘/). Two-way bound to the modal so it can
  // self-close on Escape / backdrop click without needing a callback.
  let shortcutReferenceOpen = false;

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
    const count = $nestedWorkspaces.length;
    if (_prevWorkspaceCount > 0 && count === 0) {
      primarySidebarVisible.set(false);
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
   * forward through nestedWorkspaces / panes / surfaces, wrapping around. The
   * landed surface is marked read; other unreads stay until visited.
   */
  function jumpToNextUnread(): void {
    const ws = $nestedWorkspaces;
    if (ws.length === 0) return;
    const startWsIdx = Math.max(0, $activeNestedWorkspaceIdx);
    const len = ws.length;
    for (let i = 0; i < len; i++) {
      const wsIdx = (startWsIdx + i) % len;
      const w = ws[wsIdx];
      if (!w) continue;
      const panes = getAllPanes(w.splitRoot);
      for (const p of panes) {
        const surface = p.surfaces.find((s) => s.hasUnread);
        if (!surface) continue;
        if (wsIdx !== $activeNestedWorkspaceIdx) switchNestedWorkspace(wsIdx);
        focusPane(p.id);
        selectSurface(p.id, surface.id);
        nestedWorkspaces.update((wsList) => {
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
      shortcut: `${shiftModLabel}N`,
      action: () =>
        createNestedWorkspace(`Workspace ${$nestedWorkspaces.length + 1}`),
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
          const ws = $nestedWorkspaces[$activeNestedWorkspaceIdx];
          if (!ws) return;
          await confirmAndCloseWorkspace(ws, $activeNestedWorkspaceIdx);
        })();
      },
      source: "core",
    },
    {
      // Palette-only escape hatch for nuking stale state — e.g. orphaned
      // nestedWorkspaces left behind by workspace deletion on older builds.
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
      id: "core.toggle-primary-sidebar",
      title: "Toggle Primary Sidebar",
      shortcut: `${shiftModLabel}B`,
      action: () => primarySidebarVisible.update((v) => !v),
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
      action: () => (shortcutReferenceOpen = true),
      source: "core",
    },
    {
      id: "core.workspace-switcher",
      title: "Switch Branch...",
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
    ...$nestedWorkspaces.map((ws, i) => ({
      id: `core.switch-workspace-${ws.id}`,
      title: `Switch to: ${ws.name}`,
      shortcut: i < 9 ? `${modLabel}${i + 1}` : undefined,
      action: () => switchNestedWorkspace(i),
      source: "core",
    })),
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
        if (cmd.workspace) void createNestedWorkspaceFromDef(cmd.workspace);
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
            const confirm = await showInputPrompt(
              `Update ${update.version} available. Type "yes" to install and restart`,
            );
            if (confirm?.toLowerCase() === "yes") {
              await update.downloadAndInstall();
              await relaunch();
            }
          } else {
            await showInputPrompt(
              "You're up to date! (press Enter to dismiss)",
            );
          }
        } catch (err) {
          console.error("[updater] Failed to check for updates:", err);
          await showInputPrompt(
            `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
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
    } else if (action.type === "create-workspace") {
      void createNestedWorkspaceFromDef({
        name: action.name,
        cwd: action.cwd,
        env: action.options?.env,
        metadata: action.options?.metadata,
        layout: { pane: { surfaces: [{ type: "terminal" }] } },
      });
    } else if (action.type === "open-in-editor") {
      void openInEditor(action.filePath);
    } else if (action.type === "open-surface") {
      openExtensionSurfaceInPane(
        action.surfaceTypeId,
        action.title,
        action.props,
      );
    } else if (action.type === "switch-workspace") {
      const idx = $nestedWorkspaces.findIndex(
        (w) => w.id === action.workspaceId,
      );
      if (idx >= 0) switchNestedWorkspace(idx);
    } else if (action.type === "close-workspace") {
      const idx = $nestedWorkspaces.findIndex(
        (w) => w.id === action.workspaceId,
      );
      const ws = $nestedWorkspaces[idx];
      if (idx >= 0 && ws) void confirmAndCloseWorkspace(ws, idx);
    }
  }

  // ---- Keyboard shortcuts ----

  function handleKeydown(e: KeyboardEvent) {
    handleAppKeydown(e, {
      startRenameActiveWorkspace: () =>
        sidebarComponent?.startRename($activeNestedWorkspaceIdx),
      findNext: () => findBarComponent?.findNext(),
      findPrev: () => findBarComponent?.findPrev(),
    });
  }

  // ---- Initialization ----
  let _cleanupShortcutHints: (() => void) | null = null;
  onDestroy(() => _cleanupShortcutHints?.());

  onMount(async () => {
    _cleanupShortcutHints = initShortcutHints();
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

    // Workspaces (formerly the project-scope extension) —
    // registered from core so the root-row renderer, commands, and
    // Dashboard contribution are available before extensions activate.
    await initWorkspaces();

    // Register the core settings Dashboard Workspace before extensions so the
    // gear button is wired before any extension activates.
    registerDashboardWorkspaceType({
      id: "gnar-term:settings",
      label: "Settings",
      icon: GearIcon as unknown as Component,
      component: SettingsPanel as unknown as Component,
      accentColor: "#8998A8",
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
      handler: (ctx) => {
        if (ctx.parentWorkspaceId && ctx.workspacePath) {
          const name = `Workspace ${get(nestedWorkspaces).length + 1}`;
          void createNestedWorkspaceFromDef({
            name,
            cwd: ctx.workspacePath as string,
            metadata: { parentWorkspaceId: ctx.parentWorkspaceId as string },
            layout: { pane: { surfaces: [{ type: "terminal" }] } },
          });
        } else {
          runCommandById("create-workspace");
        }
      },
    });

    await restoreWorkspaces(cliArgs, config);
    // Signal that nestedWorkspaces are in the store so deferred work (the
    // agentic extension's provision loop, reconcileWorkspaceDashboards) can
    // safely read and write the nestedWorkspaces store without racing restore.
    markRestored();

    // Re-apply the persisted window bounds. `restoreWorkspaces` calls
    // loadState() which populates the in-memory AppState — read it via
    // getState() so we don't need to thread the value back through the
    // bootstrap signature. Best-effort; failures are logged and ignored.
    void restoreWindowBounds(getState().windowBounds, getCurrentWindow());
    // Backfill primaryNestedWorkspaceId and wrap standalone nestedWorkspaces now that
    // the nestedWorkspaces store is populated.
    await reconcilePrimaryWorkspaces();
    setupPrimaryWorkspaceAutoRecreation();
    void reconcileWorkspaceDashboards();

    // Rehydrate the persisted root-row order so drag-sorted layouts
    // survive across restarts. Entities are all registered by this
    // point — extensions (projects, agent dashboards) appended during
    // activation, and restoreWorkspaces appended nestedWorkspaces — so the
    // known set is stable. bootstrapRootRowOrder re-sorts to match the
    // persisted order and appends any brand-new entity at the end.
    const currentOrder = get(rootRowOrder);
    // Pass everything except nested-workspace rows through as
    // extensionRows — those are passed via the first arg below. Pre-
    // rename this filter read `kind !== "workspace"` because "workspace"
    // used to mean nested-workspace; after the umbrella rename, that
    // filter would silently drop persisted umbrella rows on reload.
    const extensionRows = currentOrder.filter(
      (r) => r.kind !== "nested-workspace",
    );
    const claimed = get(claimedWorkspaceIds);
    bootstrapRootRowOrder(
      get(nestedWorkspaces)
        .filter((w) => !claimed.has(w.id))
        .map((w) => w.id),
      extensionRows,
    );

    if (!restoreCommandsOverlayShown) {
      const hasPending = $nestedWorkspaces.some((ws) =>
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

    // Handle status item actions (e.g., clicking "3 modified" opens diff surface)
    document.addEventListener("status-action", ((e: CustomEvent) => {
      const action = e.detail as { command: string; args?: unknown[] };
      if (action.command === "open-url" && action.args?.[0]) {
        void invoke("open_url", {
          url: action.args[0] as string,
        });
      } else if (action.command === "open-surface" && action.args) {
        const [surfaceTypeId, title, props] = action.args as [
          string,
          string,
          Record<string, unknown> | undefined,
        ];
        const open = () =>
          openExtensionSurfaceInPane(surfaceTypeId, title, props);
        void ensureProviderAndThen(surfaceTypeId, open);
      } else if (
        action.command === "open-surface-in-new-workspace" &&
        action.args
      ) {
        const [wsName, surfaceTypeId, title, props, options] = action.args as [
          string,
          string,
          string,
          Record<string, unknown> | undefined,
          { metadata?: Record<string, unknown> } | undefined,
        ];
        const open = () =>
          void createNestedWorkspaceFromDef({
            name: wsName,
            // Optional metadata forwards to the new workspace — e.g.
            // container-row dirty clicks pass `{ parentWorkspaceId: <container-id> }`
            // so the fresh "Diff" nested workspace nests inside its originating
            // workspace instead of materializing at the sidebar root.
            ...(options?.metadata ? { metadata: options.metadata } : {}),
            layout: {
              pane: {
                surfaces: [
                  {
                    type: "extension",
                    extensionType: surfaceTypeId,
                    name: title,
                    extensionProps: props ?? {},
                    focus: true,
                  },
                ],
              },
            },
          });
        void ensureProviderAndThen(surfaceTypeId, open);
      }
    }) as EventListener);

    // Track fullscreen state for layout adjustments (e.g. traffic light padding)
    const appWindow = getCurrentWindow();
    isFullscreen.set(await appWindow.isFullscreen());
    void appWindow.onResized(async () => {
      isFullscreen.set(await appWindow.isFullscreen());
    });

    // Flush workspace and extension state to disk before the window closes.
    // Tauri v2: the window closes synchronously unless we preventDefault the
    // event first. Without this, the async flush races the process teardown
    // and project membership / debounced writes can be lost on quit.
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
        flushWorkspaces(),
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

<div id="app" style="display: flex; height: 100vh; overflow: hidden;">
  <PrimarySidebar
    bind:this={sidebarComponent}
    onSwitchWorkspace={switchNestedWorkspace}
    onRenameWorkspace={renameNestedWorkspace}
    onNewSurface={newSurfaceFromSidebar}
  />

  <div
    style="
    flex: 1; display: flex; flex-direction: column;
    background: {$theme.bg}; min-width: 0; min-height: 0; overflow: hidden;
  "
  >
    <TitleBar />

    <div
      id="terminal-area"
      style="flex: 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; position: relative;"
    >
      {#each $nestedWorkspaces as ws, i (ws.id)}
        <WorkspaceView
          workspace={ws}
          visible={i === $activeNestedWorkspaceIdx &&
            $activePseudoWorkspaceId === null}
          onSelectSurface={selectSurface}
          onCloseSurface={closeSurfaceById}
          onNewSurface={newSurface}
          onSelectSurfaceType={(paneId, typeId) => {
            const typeDef = $surfaceTypeStore.find((t) => t.id === typeId);
            if (typeDef) {
              openExtensionSurfaceInPaneById(paneId, typeId, typeDef.label);
            }
          }}
          onSplitRight={(paneId) => splitPane(paneId, "horizontal")}
          onSplitDown={(paneId) => splitPane(paneId, "vertical")}
          onClosePane={closePane}
          onFocusPane={focusPane}
        />
      {/each}

      {#each $pseudoWorkspaceStore as pseudo (pseudo.id)}
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
          <svelte:component
            this={pseudo.render as import("svelte").Component}
          />
        </div>
      {/each}

      {#if ($nestedWorkspaces.length === 0 || $activeNestedWorkspaceIdx < 0) && $activePseudoWorkspaceId === null}
        <EmptySurface />
      {/if}

      <FindBar bind:this={findBarComponent} />
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
<ShortcutReference bind:open={shortcutReferenceOpen} />
<WorkspaceSwitcher bind:open={workspaceSwitcherOpen} />

<style>
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
