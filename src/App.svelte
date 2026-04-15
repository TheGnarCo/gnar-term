<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { theme, themes, xtermTheme } from "./lib/stores/theme";
  import { primarySidebarVisible, secondarySidebarVisible, commandPaletteOpen, findBarVisible, pendingAction, showInputPrompt } from "./lib/stores/ui";
  import { workspaces, activeWorkspaceIdx, activeWorkspace, activePane, activeSurface } from "./lib/stores/workspace";
  import { invoke } from "@tauri-apps/api/core";
  import { loadConfig, saveConfig, getConfig, getWorkspaceCommands, type WorkspaceDef } from "./lib/config";
  import { setupListeners, fontReady, startCwdPolling, isMac, modLabel, shiftModLabel } from "./lib/terminal-service";
  import { getAllSurfaces, isTerminalSurface } from "./lib/types";
  import { refreshPreviewStyles } from "./preview/index";
  import "./preview/init";

  // Services
  import { createWorkspace, createWorkspaceFromDef, switchWorkspace, closeWorkspace, renameWorkspace, reorderWorkspaces, saveCurrentWorkspace } from "./lib/services/workspace-service";
  import { splitPane, closePane, focusPane, reorderTab, focusDirection, flashFocusedPane, splitFromSidebar } from "./lib/services/pane-service";
  import { selectSurface, closeSurfaceById, newSurface, nextSurface, prevSurface, selectSurfaceByNumber, closeActiveSurface, openPreviewInPane, newSurfaceFromSidebar } from "./lib/services/surface-service";
  import { initMcpBridgeClient } from "./lib/services/mcp-bridge-client";

  // Components
  import PrimarySidebar from "./lib/components/PrimarySidebar.svelte";
  import SecondarySidebar from "./lib/components/SecondarySidebar.svelte";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import WorkspaceView from "./lib/components/WorkspaceView.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import FindBar from "./lib/components/FindBar.svelte";
  import ContextMenu from "./lib/components/ContextMenu.svelte";
  import InputPrompt from "./lib/components/InputPrompt.svelte";

  let sidebarComponent: PrimarySidebar;
  let findBarComponent: FindBar;

  // ---- Theme ----

  function applyTheme(id: string) {
    theme.set(id);
    for (const ws of $workspaces) {
      for (const s of getAllSurfaces(ws)) {
        if (isTerminalSurface(s)) s.terminal.options.theme = $xtermTheme;
      }
    }
    refreshPreviewStyles();
    saveConfig({ theme: id });
  }

  // ---- Command palette ----

  $: paletteCommands = [
    { name: "New Workspace", shortcut: `${shiftModLabel}N`, action: () => createWorkspace(`Workspace ${$workspaces.length + 1}`) },
    { name: "New Surface (Tab)", shortcut: `${shiftModLabel}T`, action: () => newSurfaceFromSidebar() },
    { name: "Split Right", shortcut: isMac ? `${modLabel}D` : `${shiftModLabel}D`, action: () => splitFromSidebar("horizontal") },
    { name: "Split Down", shortcut: `${shiftModLabel}D`, action: () => splitFromSidebar("vertical") },
    { name: "Close Surface", shortcut: isMac ? `${modLabel}W` : `${shiftModLabel}W`, action: () => closeActiveSurface() },
    { name: "Close Workspace", shortcut: `${shiftModLabel}W`, action: () => closeWorkspace($activeWorkspaceIdx) },
    { name: "Next Surface", shortcut: `${shiftModLabel}]`, action: () => nextSurface() },
    { name: "Previous Surface", shortcut: `${shiftModLabel}[`, action: () => prevSurface() },
    { name: "Toggle Primary Sidebar", shortcut: `${shiftModLabel}B`, action: () => primarySidebarVisible.update(v => !v) },
    { name: "Toggle Secondary Sidebar", action: () => secondarySidebarVisible.update(v => !v) },
    { name: "Toggle Find Bar", shortcut: `${shiftModLabel}F`, action: () => findBarVisible.update(v => !v) },
    { name: "Clear Scrollback", shortcut: `${shiftModLabel}K`, action: () => { const s = $activeSurface; if (s && isTerminalSurface(s)) s.terminal.clear(); } },
    ...$workspaces.map((ws, i) => ({
      name: `Switch to: ${ws.name}`,
      shortcut: i < 9 ? `${modLabel}${i + 1}` : undefined,
      action: () => switchWorkspace(i),
    })),
    { name: "Save Current Workspace...", action: () => saveCurrentWorkspace() },
    { name: `Preview File...`, action: async () => {
      const path = await showInputPrompt("Path to file");
      if (path) openPreviewInPane(path);
    }},
    ...getWorkspaceCommands().map(cmd => ({
      name: cmd.name,
      action: () => { if (cmd.workspace) createWorkspaceFromDef(cmd.workspace); },
    })),
    ...Object.entries(themes).map(([id, t]) => ({
      name: `Theme: ${t.name}`,
      action: () => applyTheme(id),
    })),
  ];

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
    }
  }

  // ---- Keyboard shortcuts ----

  function handleKeydown(e: KeyboardEvent) {
    const shift = e.shiftKey;
    const alt = e.altKey;
    const ctrl = e.ctrlKey;
    const cmd = isMac ? e.metaKey : (ctrl && shift);

    // macOS: Cmd+key (no shift) shortcuts
    if (isMac && e.metaKey && !shift && !alt) {
      if (e.key === "n") { e.preventDefault(); createWorkspace(`Workspace ${$workspaces.length + 1}`); return; }
      if (e.key === "t") { e.preventDefault(); newSurfaceFromSidebar(); return; }
      if (e.key === "d") { e.preventDefault(); splitFromSidebar("horizontal"); return; }
      if (e.key === "w") { e.preventDefault(); closeActiveSurface(); return; }
      if (e.key >= "1" && e.key <= "8") { e.preventDefault(); switchWorkspace(parseInt(e.key) - 1); return; }
      if (e.key === "9") { e.preventDefault(); switchWorkspace($workspaces.length - 1); return; }
      if (e.key === "b") { e.preventDefault(); primarySidebarVisible.update(v => !v); return; }
      if (e.key === "k") { e.preventDefault(); const s = $activeSurface; if (s && isTerminalSurface(s)) s.terminal.clear(); return; }
      if (e.key === "p") { e.preventDefault(); commandPaletteOpen.update(v => !v); return; }
      if (e.key === "f") { e.preventDefault(); findBarVisible.update(v => !v); return; }
      if (e.key === "g") { e.preventDefault(); findBarVisible.set(true); findBarComponent?.findNext(); return; }
    }

    // macOS: Ctrl+number selects surfaces
    if (isMac && ctrl && !e.metaKey && !shift && !alt && e.key >= "1" && e.key <= "8") { e.preventDefault(); selectSurfaceByNumber(parseInt(e.key)); return; }
    if (isMac && ctrl && !e.metaKey && !shift && !alt && e.key === "9") { e.preventDefault(); selectSurfaceByNumber(9); return; }

    // Shared Cmd+Shift / Ctrl+Shift shortcuts
    if (cmd && shift && !alt) {
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); newSurfaceFromSidebar(); return; }
      if (k === "n") { e.preventDefault(); createWorkspace(`Workspace ${$workspaces.length + 1}`); return; }
      if (k === "d") { e.preventDefault(); splitFromSidebar("vertical"); return; }
      if (k === "w") { e.preventDefault(); closeWorkspace($activeWorkspaceIdx); return; }
      if (k === "h") { e.preventDefault(); flashFocusedPane(); return; }
      if (k === "r") { e.preventDefault(); sidebarComponent?.startRename($activeWorkspaceIdx); return; }
      if (k === "g") { e.preventDefault(); findBarVisible.set(true); findBarComponent?.findPrev(); return; }
      if (k === "b") { e.preventDefault(); primarySidebarVisible.update(v => !v); return; }
      if (k === "p") { e.preventDefault(); commandPaletteOpen.update(v => !v); return; }
      if (k === "k") { e.preventDefault(); const s = $activeSurface; if (s && isTerminalSurface(s)) s.terminal.clear(); return; }
      if (k === "f") { e.preventDefault(); findBarVisible.update(v => !v); return; }
      if (e.key === "]") { e.preventDefault(); nextSurface(); return; }
      if (e.key === "[") { e.preventDefault(); prevSurface(); return; }
    }

    // Ctrl+Tab / Ctrl+Shift+Tab
    if (ctrl && !alt && e.key === "Tab") { e.preventDefault(); if (shift) prevSurface(); else nextSurface(); return; }

    // Alt+Cmd/Ctrl+arrows for pane navigation
    if (alt && (isMac ? e.metaKey : ctrl) && !shift) {
      if (e.key === "ArrowLeft") { e.preventDefault(); focusDirection("left"); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); focusDirection("right"); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); focusDirection("up"); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); focusDirection("down"); return; }
    }

    if (e.key === "Escape" && $findBarVisible) { e.preventDefault(); findBarVisible.set(false); return; }
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
    initMcpBridgeClient().catch((err) => console.warn("[mcp-bridge] init failed:", err));

    const cliArgs = await invoke<CliArgs>("get_cli_args");
    const config = await loadConfig(cliArgs.config || undefined);
    if (config.theme) {
      theme.set(config.theme);
    }

    const cliCwd = cliArgs.path || cliArgs.working_directory;

    if (cliArgs.workspace) {
      const cmd = config.commands?.find(
        c => c.name === cliArgs.workspace && c.workspace
      );
      if (cmd?.workspace) {
        await createWorkspaceFromDef(cmd.workspace);
      } else {
        console.warn(`[cli] Workspace "${cliArgs.workspace}" not found in config`);
        await createWorkspace(cliArgs.title || "Workspace 1");
      }
    } else if (cliCwd || cliArgs.command) {
      const wsName = cliArgs.title || cliCwd?.split("/").pop() || "Workspace 1";
      const def: WorkspaceDef = {
        name: wsName,
        cwd: cliCwd || undefined,
        layout: {
          pane: {
            surfaces: [{
              type: "terminal",
              cwd: cliCwd || undefined,
              command: cliArgs.command || undefined,
            }]
          }
        }
      };
      await createWorkspaceFromDef(def);
    } else {
      let autoloaded = false;
      if (config.autoload && config.autoload.length > 0 && config.commands) {
        for (const name of config.autoload) {
          const cmd = config.commands.find(c => c.name === name && c.workspace);
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

    listen<string>("menu-theme", (event) => {
      applyTheme(event.payload.replace("theme-", ""));
    });

    await listen("menu-cmd-palette", () => {
      commandPaletteOpen.update(v => !v);
    });

    await listen("menu-close-tab", () => {
      closeActiveSurface();
    });
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div id="app" style="display: flex; height: 100vh; overflow: hidden;">
  <PrimarySidebar
    bind:this={sidebarComponent}
    onNewWorkspace={() => createWorkspace(`Workspace ${$workspaces.length + 1}`)}
    onSwitchWorkspace={switchWorkspace}
    onCloseWorkspace={closeWorkspace}
    onRenameWorkspace={renameWorkspace}
    onNewSurface={newSurfaceFromSidebar}
    onReorderWorkspaces={reorderWorkspaces}
  />

  <div style="
    flex: 1; display: flex; flex-direction: column;
    background: {$theme.bg}; min-width: 0; min-height: 0; overflow: hidden;
  ">
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

<CommandPalette commands={paletteCommands} />
<ContextMenu />
<InputPrompt />
