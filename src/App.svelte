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
  import {
    loadConfig,
    loadState,
    saveConfig,
    getWorkspaceCommands,
    type WorkspaceDef,
  } from "./lib/config";
  import {
    setupListeners,
    fontReady,
    startCwdPolling,
    isMac,
    modLabel,
    shiftModLabel,
  } from "./lib/terminal-service";
  import { getAllSurfaces, isTerminalSurface } from "./lib/types";
  import { check } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { eventBus } from "./lib/services/event-bus";

  // Included extensions
  import {
    previewManifest,
    registerPreviewExtension,
  } from "./extensions/preview";
  import {
    fileBrowserManifest,
    registerFileBrowserExtension,
  } from "./extensions/file-browser";
  import {
    profileCardManifest,
    registerProfileCardExtension,
  } from "./extensions/profile-card";
  import {
    managedWorkspacesManifest,
    registerManagedWorkspacesExtension,
  } from "./extensions/managed-workspaces";
  import {
    agenticOrchestratorManifest,
    registerAgenticOrchestratorExtension,
  } from "./extensions/agentic-orchestrator";
  import { githubManifest, registerGitHubExtension } from "./extensions/github";
  import {
    projectScopeManifest,
    registerProjectScopeExtension,
  } from "./extensions/project-scope";
  import {
    diffViewerManifest,
    registerDiffViewerExtension,
  } from "./extensions/diff-viewer";
  import {
    gitStatusManifest,
    registerGitStatusExtension,
  } from "./extensions/git-status";
  import {
    registerExtension,
    activateExtension,
    extensionStore,
    extensionErrorStore,
    reportExtensionError,
    flushAllExtensionState,
  } from "./lib/services/extension-loader";
  import { loadExternalExtensions } from "./lib/services/extension-management";

  // Services
  import {
    createWorkspace,
    createWorkspaceFromDef,
    switchWorkspace,
    closeWorkspace,
    renameWorkspace,
    reorderWorkspaces,
    saveCurrentWorkspace,
    persistWorkspaces,
  } from "./lib/services/workspace-service";
  import {
    splitPane,
    closePane,
    focusPane,
    reorderTab,
    focusDirection,
    flashFocusedPane,
    splitFromSidebar,
  } from "./lib/services/pane-service";
  import {
    selectSurface,
    closeSurfaceById,
    newSurface,
    nextSurface,
    prevSurface,
    selectSurfaceByNumber,
    closeActiveSurface,
    openExtensionSurfaceInPane,
    openExtensionSurfaceInPaneById,
    newSurfaceWithCommand,
    newSurfaceFromSidebar,
  } from "./lib/services/surface-service";
  import {
    registerCommands,
    executeByShortcut,
  } from "./lib/services/command-registry";
  import {
    registerWorkspaceAction,
    executeWorkspaceActionByShortcut,
  } from "./lib/services/workspace-action-registry";
  import { initMcpServer } from "./lib/services/mcp-server";

  // Components
  import PrimarySidebar from "./lib/components/PrimarySidebar.svelte";
  import SecondarySidebar from "./lib/components/SecondarySidebar.svelte";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import WorkspaceView from "./lib/components/WorkspaceView.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import FindBar from "./lib/components/FindBar.svelte";
  import ContextMenu from "./lib/components/ContextMenu.svelte";
  import InputPrompt from "./lib/components/InputPrompt.svelte";
  import FormPrompt from "./lib/components/FormPrompt.svelte";
  import SettingsOverlay from "./lib/components/SettingsOverlay.svelte";
  import { overlayStore } from "./lib/services/overlay-registry";
  import { surfaceTypeStore } from "./lib/services/surface-type-registry";
  import ExtensionWrapper from "./lib/components/ExtensionWrapper.svelte";
  import { getExtensionApiById } from "./lib/services/extension-loader";

  const TOAST_DURATION_MS = 5000;

  let sidebarComponent: PrimarySidebar;
  let findBarComponent: FindBar;

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
      id: "core.split-down",
      title: "Split Down",
      shortcut: `${shiftModLabel}D`,
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
      id: "core.close-workspace",
      title: "Close Workspace",
      shortcut: `${shiftModLabel}W`,
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
    // Try command-palette-registered shortcuts first, then extension-
    // registered workspace-action shortcuts.
    if (executeByShortcut(e)) return;
    if (executeWorkspaceActionByShortcut(e)) return;

    const shift = e.shiftKey;
    const alt = e.altKey;
    const ctrl = e.ctrlKey;

    // macOS: Cmd+key (no shift) shortcuts not covered by command palette
    // (palette uses ⇧⌘ for most; these are bare ⌘ quick-access variants)
    if (isMac && e.metaKey && !shift && !alt) {
      const cmdShortcuts: Record<string, () => void> = {
        n: () => createWorkspace(`Workspace ${$workspaces.length + 1}`),
        t: () => newSurfaceFromSidebar(),
        b: () => primarySidebarVisible.update((v) => !v),
        k: () => {
          const s = $activeSurface;
          if (s && isTerminalSurface(s)) s.terminal.clear();
        },
        p: () => commandPaletteOpen.update((v) => !v),
        f: () => findBarVisible.update((v) => !v),
        g: () => {
          findBarVisible.set(true);
          findBarComponent?.findNext();
        },
      };
      const handler = cmdShortcuts[e.key];
      if (handler) {
        e.preventDefault();
        handler();
        return;
      }
    }

    // Shortcuts that reference component bindings or aren't in the command palette
    if ((isMac ? e.metaKey : ctrl && shift) && shift && !alt) {
      const k = e.key.toLowerCase();
      if (k === "h") {
        e.preventDefault();
        flashFocusedPane();
        return;
      }
      if (k === "r") {
        e.preventDefault();
        sidebarComponent?.startRename($activeWorkspaceIdx);
        return;
      }
      if (k === "g") {
        e.preventDefault();
        findBarVisible.set(true);
        findBarComponent?.findPrev();
        return;
      }
      if (k === "p") {
        e.preventDefault();
        commandPaletteOpen.update((v) => !v);
        return;
      }
    }

    // macOS: Ctrl+number selects surfaces
    if (
      isMac &&
      ctrl &&
      !e.metaKey &&
      !shift &&
      !alt &&
      e.key >= "1" &&
      e.key <= "8"
    ) {
      e.preventDefault();
      selectSurfaceByNumber(parseInt(e.key));
      return;
    }
    if (isMac && ctrl && !e.metaKey && !shift && !alt && e.key === "9") {
      e.preventDefault();
      selectSurfaceByNumber(9);
      return;
    }

    // Ctrl+Tab / Ctrl+Shift+Tab
    if (ctrl && !alt && e.key === "Tab") {
      e.preventDefault();
      if (shift) prevSurface();
      else nextSurface();
      return;
    }

    // Alt+Cmd/Ctrl+arrows for pane navigation
    if (alt && (isMac ? e.metaKey : ctrl) && !shift) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        focusDirection("left");
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        focusDirection("right");
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        focusDirection("up");
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusDirection("down");
        return;
      }
    }

    if (e.key === "Escape" && $settingsOpen) {
      e.preventDefault();
      settingsOpen.set(false);
      return;
    }
    if (e.key === "Escape" && $findBarVisible) {
      e.preventDefault();
      findBarVisible.set(false);
      return;
    }
  }

  // ---- CLI args type ----
  interface CliArgs {
    path: string | null;
    working_directory: string | null;
    command: string | null;
    title: string | null;
    workspace: string | null;
    config: string | null;
  }

  // ---- Initialization ----
  onMount(async () => {
    await fontReady;
    void setupListeners();
    startCwdPolling();
    initMcpServer().catch((err) => console.warn("[mcp] init failed:", err));

    // Load config before extensions so getSetting() works in onActivate
    const cliArgs = await invoke<CliArgs>("get_cli_args");
    const config = await loadConfig(cliArgs.config || undefined);
    if (config.theme) {
      theme.set(config.theme);
    }

    // Register included extensions. Only activate if explicitly enabled in config —
    // a fresh install starts with no extensions active (opt-in model).
    const extConfig = config.extensions || {};
    for (const [manifest, registerFn, label] of [
      [previewManifest, registerPreviewExtension, "preview"],
      [fileBrowserManifest, registerFileBrowserExtension, "file-browser"],
      [profileCardManifest, registerProfileCardExtension, "profile-card"],
      [
        managedWorkspacesManifest,
        registerManagedWorkspacesExtension,
        "managed-workspaces",
      ],
      [
        agenticOrchestratorManifest,
        registerAgenticOrchestratorExtension,
        "agentic-orchestrator",
      ],
      [githubManifest, registerGitHubExtension, "github"],
      [projectScopeManifest, registerProjectScopeExtension, "project-scope"],
      [diffViewerManifest, registerDiffViewerExtension, "diff-viewer"],
      [gitStatusManifest, registerGitStatusExtension, "git-status"],
    ] as const) {
      try {
        registerExtension(manifest, registerFn);
        if (extConfig[label]?.enabled) {
          await activateExtension(label);
        }
      } catch (err) {
        console.error(
          `[app] Failed to load included extension "${label}":`,
          err,
        );
        reportExtensionError(
          label,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

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

    const cliCwd = cliArgs.path || cliArgs.working_directory;

    if (cliArgs.workspace) {
      const cmd = config.commands?.find(
        (c) => c.name === cliArgs.workspace && c.workspace,
      );
      if (cmd?.workspace) {
        await createWorkspaceFromDef(cmd.workspace);
      } else {
        console.warn(
          `[cli] Workspace "${cliArgs.workspace}" not found in config`,
        );
        await createWorkspace(cliArgs.title || "Workspace 1");
      }
    } else if (cliCwd || cliArgs.command) {
      const wsName = cliArgs.title || cliCwd?.split("/").pop() || "Workspace 1";
      const def: WorkspaceDef = {
        name: wsName,
        cwd: cliCwd || undefined,
        layout: {
          pane: {
            surfaces: [
              {
                type: "terminal",
                cwd: cliCwd || undefined,
                command: cliArgs.command || undefined,
              },
            ],
          },
        },
      };
      await createWorkspaceFromDef(def);
    } else {
      // Try to restore persisted workspaces from state.json
      const state = await loadState();
      let restored = false;
      if (state.workspaces && state.workspaces.length > 0) {
        // Clear any existing workspaces to prevent doubling on re-mount
        workspaces.set([]);
        for (const wsDef of state.workspaces) {
          await createWorkspaceFromDef(wsDef);
        }
        const idx = state.activeWorkspaceIdx ?? 0;
        switchWorkspace(Math.min(idx, state.workspaces.length - 1));
        restored = true;
      }
      if (!restored) {
        // Fall back to autoload from config, then default workspace
        let autoloaded = false;
        if (config.autoload && config.autoload.length > 0 && config.commands) {
          for (const name of config.autoload) {
            const cmd = config.commands.find(
              (c) => c.name === name && c.workspace,
            );
            if (cmd?.workspace) {
              await createWorkspaceFromDef(cmd.workspace);
              autoloaded = true;
            }
          }
        }
        if (!autoloaded) {
          await createWorkspace("Workspace 1");
        }
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
    onReorderWorkspaces={reorderWorkspaces}
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
