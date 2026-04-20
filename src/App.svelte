<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { theme, themes, xtermTheme } from "./lib/stores/theme";
  import {
    isFullscreen,
    primarySidebarVisible,
    secondarySidebarVisible,
    commandPaletteOpen,
    findBarVisible,
    settingsOpen,
    settingsPage,
    pendingAction,
    showInputPrompt,
  } from "./lib/stores/ui";
  import {
    workspaces,
    activeWorkspaceIdx,
    activePane,
    activeSurface,
  } from "./lib/stores/workspace";
  import { get } from "svelte/store";
  import { invoke } from "@tauri-apps/api/core";
  import { loadConfig, saveConfig, getWorkspaceCommands } from "./lib/config";
  import {
    setupListeners,
    fontReady,
    startCwdPolling,
    isMac,
    modLabel,
    shiftModLabel,
  } from "./lib/terminal-service";
  import { getAllSurfaces, getAllPanes, isTerminalSurface } from "./lib/types";
  import { check } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { eventBus } from "./lib/services/event-bus";

  // Extension lifecycle
  import {
    extensionStore,
    extensionErrorStore,
    reportExtensionError,
    flushAllExtensionState,
  } from "./lib/services/extension-loader";
  import { loadExternalExtensions } from "./lib/services/extension-management";
  import { registerIncludedExtensions } from "./lib/bootstrap/register-included-extensions";
  import { initWorktrees } from "./lib/bootstrap/init-worktrees";
  import { initGitStatus } from "./lib/bootstrap/init-git-status";
  import { initPreview } from "./lib/bootstrap/init-preview";
  import { initAgentDetectionBootstrap } from "./lib/bootstrap/init-agent-detection";
  import {
    restoreWorkspaces,
    type CliArgs,
  } from "./lib/bootstrap/restore-workspaces";

  // Services
  import {
    createWorkspace,
    createWorkspaceFromDef,
    switchWorkspace,
    closeWorkspace,
    renameWorkspace,
    saveCurrentWorkspace,
    persistWorkspaces,
  } from "./lib/services/workspace-service";
  import {
    splitPane,
    closePane,
    focusPane,
    reorderTab,
    splitFromSidebar,
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
  import { registerCommands } from "./lib/services/command-registry";
  import { registerWorkspaceAction } from "./lib/services/workspace-action-registry";
  import { initMcpServer } from "./lib/services/mcp-server";
  import { handleAppKeydown } from "./lib/services/keyboard-shortcuts";

  // Components
  import PrimarySidebar from "./lib/components/PrimarySidebar.svelte";
  import SecondarySidebar from "./lib/components/SecondarySidebar.svelte";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import WorkspaceView from "./lib/components/WorkspaceView.svelte";
  import EmptySurface from "./lib/components/EmptySurface.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import FindBar from "./lib/components/FindBar.svelte";
  import ContextMenu from "./lib/components/ContextMenu.svelte";
  import InputPrompt from "./lib/components/InputPrompt.svelte";
  import FormPrompt from "./lib/components/FormPrompt.svelte";
  import SettingsOverlay from "./lib/components/SettingsOverlay.svelte";
  import RestoreCommandsOverlay from "./lib/components/RestoreCommandsOverlay.svelte";
  import { overlayStore } from "./lib/services/overlay-registry";
  import { surfaceTypeStore } from "./lib/services/surface-type-registry";
  import ExtensionWrapper from "./lib/components/ExtensionWrapper.svelte";
  import { getExtensionApiById } from "./lib/services/extension-loader";

  const TOAST_DURATION_MS = 5000;

  let sidebarComponent: PrimarySidebar;
  let findBarComponent: FindBar;

  // Module-scoped within this component instance; gates the bulk
  // "Restore commands?" dialog so it only fires once per launch even if
  // workspaces are re-restored later (rare, but possible via dev reload).
  let restoreCommandsOverlayShown = false;
  let showRestoreCommandsOverlay = false;

  // ---- Extension error toast ----
  let activeToasts: {
    id: string;
    name: string;
    timerId: ReturnType<typeof setTimeout>;
  }[] = [];
  const shownErrorIds = new Set<string>();

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
    settingsPage.set("extensions");
    settingsOpen.set(true);
  }

  // ---- Theme ----

  function applyTheme(id: string) {
    const previousId = get(theme.id);
    theme.set(id);
    for (const ws of $workspaces) {
      for (const s of getAllSurfaces(ws)) {
        if (isTerminalSurface(s)) s.terminal.options.theme = $xtermTheme;
      }
    }
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
      const panes = getAllPanes(w.splitRoot);
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
      shortcut: `${shiftModLabel}N`,
      action: () => createWorkspace(`Workspace ${$workspaces.length + 1}`),
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
      action: () => closeWorkspace($activeWorkspaceIdx),
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
      id: "core.toggle-secondary-sidebar",
      title: "Toggle Secondary Sidebar",
      action: () => secondarySidebarVisible.update((v) => !v),
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
      action: () => settingsOpen.update((v) => !v),
      source: "core",
    },
    {
      id: "core.clear-scrollback",
      title: "Clear Scrollback",
      shortcut: `${shiftModLabel}K`,
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
    ...$workspaces.map((ws, i) => ({
      id: `core.switch-workspace-${ws.id}`,
      title: `Switch to: ${ws.name}`,
      shortcut: i < 9 ? `${modLabel}${i + 1}` : undefined,
      action: () => switchWorkspace(i),
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
      action: () => {
        settingsPage.set("extensions");
        settingsOpen.set(true);
      },
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
        action: () => {
          settingsPage.set(`ext:${ext.manifest.id}`);
          settingsOpen.set(true);
        },
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
      void createWorkspaceFromDef({
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
      const idx = $workspaces.findIndex((w) => w.id === action.workspaceId);
      if (idx >= 0) switchWorkspace(idx);
    } else if (action.type === "close-workspace") {
      const idx = $workspaces.findIndex((w) => w.id === action.workspaceId);
      if (idx >= 0) closeWorkspace(idx);
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
  onMount(async () => {
    await fontReady;
    void setupListeners();
    startCwdPolling();
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
    if (config.theme) {
      theme.set(config.theme);
    }

    // Wire core worktree handling before extensions register so any
    // extension subscribing to "worktree:merged" finds the emitter live.
    initWorktrees();
    initGitStatus();
    initPreview();
    initAgentDetectionBootstrap();

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
      shortcut: isMac ? "Cmd+Shift+N" : "Ctrl+Shift+N",
      source: "core",
      handler: (ctx) => {
        const name = `Workspace ${get(workspaces).length + 1}`;
        if (ctx.projectId && ctx.projectPath) {
          void createWorkspaceFromDef({
            name,
            cwd: ctx.projectPath as string,
            metadata: { projectId: ctx.projectId },
            layout: { pane: { surfaces: [{ type: "terminal" }] } },
          });
        } else {
          void createWorkspace(name);
        }
      },
    });

    await restoreWorkspaces(cliArgs, config);

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

    // Handle status item actions (e.g., clicking "3 modified" opens diff surface)
    document.addEventListener("status-action", ((e: CustomEvent) => {
      const action = e.detail as { command: string; args?: unknown[] };
      if (action.command === "open-url" && action.args?.[0]) {
        void invoke("open_with_default_app", {
          path: action.args[0] as string,
        });
      } else if (action.command === "open-surface" && action.args) {
        const [surfaceTypeId, title, props] = action.args as [
          string,
          string,
          Record<string, unknown> | undefined,
        ];
        openExtensionSurfaceInPane(surfaceTypeId, title, props);
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
      // Run both flushes defensively so one failure can't strand the other.
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

<div id="app" style="display: flex; height: 100vh; overflow: hidden;">
  <PrimarySidebar
    bind:this={sidebarComponent}
    onSwitchWorkspace={switchWorkspace}
    onCloseWorkspace={closeWorkspace}
    onRenameWorkspace={renameWorkspace}
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
      {#each $workspaces as ws, i (ws.id)}
        <WorkspaceView
          workspace={ws}
          visible={i === $activeWorkspaceIdx}
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
          onReorderTab={reorderTab}
        />
      {/each}

      {#if $workspaces.length === 0}
        <EmptySurface />
      {/if}

      <FindBar bind:this={findBarComponent} />
    </div>
  </div>

  <SecondarySidebar />
</div>

<CommandPalette />
<ContextMenu />
<InputPrompt />
<FormPrompt />
<SettingsOverlay />
{#if showRestoreCommandsOverlay}
  <RestoreCommandsOverlay
    onClose={() => (showRestoreCommandsOverlay = false)}
  />
{/if}
{#each $overlayStore as overlay (overlay.id)}
  {@const overlayApi = getExtensionApiById(overlay.source)}
  {#if overlayApi}
    <ExtensionWrapper
      api={overlayApi}
      component={overlay.component}
      props={overlay.props ?? {}}
    />
  {/if}
{/each}

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
