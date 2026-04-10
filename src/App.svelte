<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { theme, themes, xtermTheme } from "./lib/stores/theme";
  import {
    primarySidebarVisible,
    secondarySidebarVisible,
    commandPaletteOpen,
    findBarVisible,
    settingsOpen,
    pendingAction,
  } from "./lib/stores/ui";
  import {
    workspaces,
    activeWorkspaceIdx,
    activePane,
    activeSurface,
  } from "./lib/stores/workspace";
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
    dashboardManifest,
    registerDashboardExtension,
  } from "./extensions/dashboard";
  import {
    registerExtension,
    activateExtension,
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
    openPreviewInPane,
    openExtensionSurfaceInPane,
    newSurfaceFromSidebar,
  } from "./lib/services/surface-service";
  import { registerCommands } from "./lib/services/command-registry";

  // Components
  import PrimarySidebar from "./lib/components/PrimarySidebar.svelte";
  import SecondarySidebar from "./lib/components/SecondarySidebar.svelte";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import WorkspaceView from "./lib/components/WorkspaceView.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import FindBar from "./lib/components/FindBar.svelte";
  import ContextMenu from "./lib/components/ContextMenu.svelte";
  import InputPrompt from "./lib/components/InputPrompt.svelte";
  import SettingsOverlay from "./lib/components/SettingsOverlay.svelte";

  let sidebarComponent: PrimarySidebar;
  let findBarComponent: FindBar;

  // ---- Theme ----

  function applyTheme(id: string) {
    let previousId = "";
    theme.id.subscribe((v) => (previousId = v))();
    theme.set(id);
    for (const ws of $workspaces) {
      for (const s of getAllSurfaces(ws)) {
        if (isTerminalSurface(s)) s.terminal.options.theme = $xtermTheme;
      }
    }
    eventBus.emit({ type: "theme:changed", id, previousId });
    saveConfig({ theme: id });
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
        if (cmd.workspace) createWorkspaceFromDef(cmd.workspace);
      },
      source: "core",
    })),
    ...Object.entries(themes).map(([id, t]) => ({
      id: `core.theme-${id}`,
      title: `Theme: ${t.name}`,
      action: () => applyTheme(id),
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
    await newSurface(pane.id);
    // Wait for PTY to spawn and shell to initialize, then send the command
    const surface = pane.surfaces[pane.surfaces.length - 1];
    if (!surface || !isTerminalSurface(surface)) return;
    const escaped = filePath.replace(/'/g, "'\\''");
    const waitAndSend = () => {
      if (surface.ptyId >= 0) {
        invoke("write_pty", {
          ptyId: surface.ptyId,
          data: `\${EDITOR:-vi} '${escaped}'\n`,
        });
      } else {
        setTimeout(waitAndSend, 50);
      }
    };
    setTimeout(waitAndSend, 100);
  }

  // ---- Pending action consumer ----

  $: if ($pendingAction) {
    const action = $pendingAction;
    pendingAction.set(null);
    if (action.type === "open-preview" && action.payload) {
      openPreviewInPane(action.payload);
    } else if (action.type === "split-right") {
      splitFromSidebar("horizontal");
    } else if (action.type === "split-down") {
      splitFromSidebar("vertical");
    } else if (action.type === "create-workspace") {
      createWorkspaceFromDef({
        name: action.name,
        cwd: action.cwd,
        env: action.options?.env,
        metadata: action.options?.metadata,
        layout: { pane: { surfaces: [{ type: "terminal" }] } },
      });
    } else if (action.type === "open-in-editor") {
      openInEditor(action.filePath);
    } else if (action.type === "open-surface") {
      openExtensionSurfaceInPane(
        action.surfaceTypeId,
        action.title,
        action.props,
      );
    }
  }

  // ---- Keyboard shortcuts ----

  function handleKeydown(e: KeyboardEvent) {
    const shift = e.shiftKey;
    const alt = e.altKey;
    const ctrl = e.ctrlKey;
    const cmd = isMac ? e.metaKey : ctrl && shift;

    // macOS: Cmd+key (no shift) shortcuts
    if (isMac && e.metaKey && !shift && !alt) {
      if (e.key === "n") {
        e.preventDefault();
        createWorkspace(`Workspace ${$workspaces.length + 1}`);
        return;
      }
      if (e.key === "t") {
        e.preventDefault();
        newSurfaceFromSidebar();
        return;
      }
      if (e.key === "d") {
        e.preventDefault();
        splitFromSidebar("horizontal");
        return;
      }
      if (e.key === "w") {
        e.preventDefault();
        closeActiveSurface();
        return;
      }
      if (e.key >= "1" && e.key <= "8") {
        e.preventDefault();
        switchWorkspace(parseInt(e.key) - 1);
        return;
      }
      if (e.key === "9") {
        e.preventDefault();
        switchWorkspace($workspaces.length - 1);
        return;
      }
      if (e.key === "b") {
        e.preventDefault();
        primarySidebarVisible.update((v) => !v);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        const s = $activeSurface;
        if (s && isTerminalSurface(s)) s.terminal.clear();
        return;
      }
      if (e.key === "p") {
        e.preventDefault();
        commandPaletteOpen.update((v) => !v);
        return;
      }
      if (e.key === "f") {
        e.preventDefault();
        findBarVisible.update((v) => !v);
        return;
      }
      if (e.key === "g") {
        e.preventDefault();
        findBarVisible.set(true);
        findBarComponent?.findNext();
        return;
      }
      if (e.key === ",") {
        e.preventDefault();
        settingsOpen.update((v) => !v);
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

    // Shared Cmd+Shift / Ctrl+Shift shortcuts
    if (cmd && shift && !alt) {
      const k = e.key.toLowerCase();
      if (k === "t") {
        e.preventDefault();
        newSurfaceFromSidebar();
        return;
      }
      if (k === "n") {
        e.preventDefault();
        createWorkspace(`Workspace ${$workspaces.length + 1}`);
        return;
      }
      if (k === "d") {
        e.preventDefault();
        splitFromSidebar("vertical");
        return;
      }
      if (k === "w") {
        e.preventDefault();
        closeWorkspace($activeWorkspaceIdx);
        return;
      }
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
      if (k === "b") {
        e.preventDefault();
        primarySidebarVisible.update((v) => !v);
        return;
      }
      if (k === "p") {
        e.preventDefault();
        commandPaletteOpen.update((v) => !v);
        return;
      }
      if (k === "k") {
        e.preventDefault();
        const s = $activeSurface;
        if (s && isTerminalSurface(s)) s.terminal.clear();
        return;
      }
      if (k === "f") {
        e.preventDefault();
        findBarVisible.update((v) => !v);
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        nextSurface();
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        prevSurface();
        return;
      }
    }

    // Linux: Ctrl+, for settings
    if (!isMac && ctrl && !shift && !alt && e.key === ",") {
      e.preventDefault();
      settingsOpen.update((v) => !v);
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
    setupListeners();
    startCwdPolling();

    // Load config before extensions so getSetting() works in onActivate
    const cliArgs = await invoke<CliArgs>("get_cli_args");
    const config = await loadConfig(cliArgs.config || undefined);
    if (config.theme) {
      theme.set(config.theme);
    }

    // Register and activate included extensions individually so one failure
    // doesn't block the others or prevent external extensions from loading.
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
      [dashboardManifest, registerDashboardExtension, "dashboard"],
    ] as const) {
      try {
        registerExtension(manifest, registerFn);
        await activateExtension(label);
      } catch (err) {
        console.error(
          `[app] Failed to load included extension "${label}":`,
          err,
        );
      }
    }

    // Load external extensions from config (after config is loaded)
    await loadExternalExtensions();

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

    listen<string>("menu-theme", (event) => {
      applyTheme(event.payload.replace("theme-", ""));
    });

    await listen("menu-cmd-palette", () => {
      commandPaletteOpen.update((v) => !v);
    });

    await listen("menu-close-tab", () => {
      closeActiveSurface();
    });

    // Flush workspace state to disk before the window closes
    getCurrentWindow().onCloseRequested(async () => {
      await persistWorkspaces();
    });
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div id="app" style="display: flex; height: 100vh; overflow: hidden;">
  <PrimarySidebar
    bind:this={sidebarComponent}
    onNewWorkspace={() =>
      createWorkspace(`Workspace ${$workspaces.length + 1}`)}
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
<SettingsOverlay />
