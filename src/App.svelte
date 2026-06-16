<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { theme, themes, xtermTheme } from "./lib/stores/theme";
  import { sidebarVisible, commandPaletteOpen, findBarVisible, pendingAction, showInputPrompt } from "./lib/stores/ui";
  import { workspaces, activeWorkspaceIdx, activeWorkspace, activePane, activeSurface } from "./lib/stores/workspace";
  import { workspaceOrder } from "./lib/stores/workspace-order";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { loadConfig, saveConfig, getConfig, getWorkspaceCommands } from "./lib/config";
  import { setupListeners, fontReady, startCwdPolling, isMac, modLabel, shiftModLabel, adjustFontSize, resetFontSize } from "./lib/terminal-service";
  import { getAllSurfaces, isTerminalSurface } from "./lib/types";
  import { refreshPreviewStyles } from "./preview/index";
  import "./preview/init";

  // Services
  import { createWorkspace, createWorkspaceFromDef, switchWorkspace, closeWorkspace, renameWorkspace, reorderWorkspaces, saveCurrentWorkspace } from "./lib/services/workspace-service";
  import { initWorkspaces } from "./lib/services/init-workspaces";
  import { splitPane, closePane, focusPane, focusDirection, flashFocusedPane, splitFromSidebar, togglePaneZoom } from "./lib/services/pane-service";
  import { handleMenuPaste } from "./lib/services/menu-paste-router";
  import { selectSurface, closeSurfaceById, newSurface, nextSurface, prevSurface, selectSurfaceByNumber, closeActiveSurface, openPreviewInPane, newSurfaceFromSidebar } from "./lib/services/surface-service";
  import {
    switchToOrderedWorkspace,
    switchToLastOrderedWorkspace,
    orderedAnchorWorkspaces,
    groupActiveWorkspace,
    addActiveToGroup,
    ungroupActiveWorkspace,
    toggleActiveGroupCollapsed,
    anchorsWithMembers,
    groupIdOf,
  } from "./lib/services/grouping-commands";
  import { initMcpServer } from "./lib/services/mcp-server";
  import { confirmQuit } from "./lib/services/quit-confirmation-service";

  // Components
  import Sidebar from "./lib/components/Sidebar.svelte";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import WorkspaceView from "./lib/components/WorkspaceView.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import FindBar from "./lib/components/FindBar.svelte";
  import ContextMenu from "./lib/components/ContextMenu.svelte";
  import InputPrompt from "./lib/components/InputPrompt.svelte";
  import ConfirmPrompt from "./lib/components/ConfirmPrompt.svelte";

  let sidebarComponent: Sidebar;
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

  // Display-ordered anchor rows — recomputed whenever the store or row order
  // changes so "Switch to:" / ⌘1-9 follow the sidebar, not the raw array.
  $: orderedAnchors = ($workspaces, $workspaceOrder, orderedAnchorWorkspaces());
  // The group (if any) the active workspace belongs to, for the
  // collapse/expand + ungroup palette entries.
  $: activeGroupId = $activeWorkspace ? groupIdOf($activeWorkspace) : null;
  // Anchors that already own members — targets for "Add to Group".
  $: groupTargets = ($workspaces, anchorsWithMembers());

  $: paletteCommands = [
    { name: "New Workspace", shortcut: `${shiftModLabel}N`, action: () => createWorkspace(`Workspace ${$workspaces.length + 1}`) },
    { name: "New Surface (Tab)", shortcut: `${shiftModLabel}T`, action: () => newSurfaceFromSidebar() },
    { name: "Split Right", shortcut: isMac ? `${modLabel}D` : `${shiftModLabel}D`, action: () => splitFromSidebar("horizontal") },
    { name: "Split Down", shortcut: `${shiftModLabel}D`, action: () => splitFromSidebar("vertical") },
    { name: "Close Surface", shortcut: isMac ? `${modLabel}W` : `${shiftModLabel}W`, action: () => closeActiveSurface() },
    { name: "Close Workspace", shortcut: `${shiftModLabel}W`, action: () => closeWorkspace($activeWorkspaceIdx) },
    { name: "Next Surface", shortcut: `${shiftModLabel}]`, action: () => nextSurface() },
    { name: "Previous Surface", shortcut: `${shiftModLabel}[`, action: () => prevSurface() },
    { name: "Toggle Sidebar", shortcut: `${shiftModLabel}B`, action: () => sidebarVisible.update(v => !v) },
    { name: "Toggle Find Bar", shortcut: `${shiftModLabel}F`, action: () => findBarVisible.update(v => !v) },
    { name: "Clear Scrollback", shortcut: `${shiftModLabel}K`, action: () => { const s = $activeSurface; if (s && isTerminalSurface(s)) s.terminal.clear(); } },
    ...orderedAnchors.map((ws, i) => ({
      name: `Switch to: ${ws.name}`,
      shortcut: i < 9 ? `${modLabel}${i + 1}` : undefined,
      action: () => switchToOrderedWorkspace(i),
    })),
    { name: "Group Workspaces", action: () => groupActiveWorkspace() },
    ...groupTargets.map((anchor) => ({
      name: `Add to Group: ${anchor.name}`,
      action: () => addActiveToGroup(anchor.id),
    })),
    ...(activeGroupId ? [
      { name: "Ungroup", action: () => ungroupActiveWorkspace() },
      { name: "Collapse/Expand Group", action: () => toggleActiveGroupCollapsed() },
    ] : []),
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
      if (e.key >= "1" && e.key <= "8") { e.preventDefault(); switchToOrderedWorkspace(parseInt(e.key) - 1); return; }
      if (e.key === "9") { e.preventDefault(); switchToLastOrderedWorkspace(); return; }
      if (e.key === "b") { e.preventDefault(); sidebarVisible.update(v => !v); return; }
      if (e.key === "k") { e.preventDefault(); const s = $activeSurface; if (s && isTerminalSurface(s)) s.terminal.clear(); return; }
      if (e.key === "p") { e.preventDefault(); commandPaletteOpen.update(v => !v); return; }
      if (e.key === "f") { e.preventDefault(); findBarVisible.update(v => !v); return; }
      if (e.key === "g") { e.preventDefault(); findBarVisible.set(true); findBarComponent?.findNext(); return; }
      if (e.key === "=" || e.key === "+") { e.preventDefault(); adjustFontSize(1); return; }
      if (e.key === "-") { e.preventDefault(); adjustFontSize(-1); return; }
      if (e.key === "0") { e.preventDefault(); resetFontSize(); return; }
    }

    // Linux/Windows: Ctrl+=/-/0 adjust terminal font size
    if (!isMac && ctrl && !shift && !alt) {
      if (e.key === "=" || e.key === "+") { e.preventDefault(); adjustFontSize(1); return; }
      if (e.key === "-") { e.preventDefault(); adjustFontSize(-1); return; }
      if (e.key === "0") { e.preventDefault(); resetFontSize(); return; }
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
      if (k === "b") { e.preventDefault(); sidebarVisible.update(v => !v); return; }
      if (k === "p") { e.preventDefault(); commandPaletteOpen.update(v => !v); return; }
      if (k === "k") { e.preventDefault(); const s = $activeSurface; if (s && isTerminalSurface(s)) s.terminal.clear(); return; }
      if (k === "f") { e.preventDefault(); findBarVisible.update(v => !v); return; }
      if (e.key === "Enter") { e.preventDefault(); const s = $activeSurface; if (s) togglePaneZoom(s.id); return; }
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
    initMcpServer().catch((err) => console.warn("[mcp] init failed:", err));

    const cliArgs = await invoke<CliArgs>("get_cli_args");
    const config = await loadConfig(cliArgs.config || undefined);
    if (config.theme) {
      theme.set(config.theme);
    }

    // Boot path: restore the persisted session (workspaces, grouping, row
    // order, collapse, sidebar visibility) instead of always rebuilding fresh.
    await initWorkspaces(cliArgs, config);

    listen<string>("menu-theme", (event) => {
      applyTheme(event.payload.replace("theme-", ""));
    });

    await listen("menu-cmd-palette", () => {
      commandPaletteOpen.update(v => !v);
    });

    await listen("menu-close-tab", () => {
      closeActiveSurface();
    });

    // Edit > Paste routes here so terminals get bracketed paste (the native
    // paste bypasses xterm's \x1b[200~ wrapping, breaking multiline paste).
    await listen("menu-paste", () => {
      void handleMenuPaste();
    });

    // Don't tear down live PTYs silently — intercept the window close request
    // and confirm when terminals are still running.
    const appWindow = getCurrentWindow();
    await appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (await confirmQuit()) {
        await appWindow.destroy();
      }
    });
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div id="app" style="display: flex; height: 100vh; overflow: hidden; --theme-accent: {$theme.accent}; --theme-fg-dim: {$theme.fgDim};">
  <Sidebar
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
        />
      {/each}

      <FindBar bind:this={findBarComponent} />
    </div>
  </div>
</div>

<CommandPalette commands={paletteCommands} />
<ContextMenu />
<InputPrompt />
<ConfirmPrompt />

<style>
  /* xterm.js v6 ships an unstyled `.xterm-slider` thumb (its CSS depends on a
     VSCode scrollbar-slider var we don't set), which leaves an empty rail with
     no visible handle in terminal panes. Paint the thumb with the theme's
     dimmed foreground and brighten on hover/active so it's discoverable. */
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

  /* Suppress the default focus outline but keep a visible keyboard ring on
     :focus-visible, so mouse focus stays clean without losing a11y. */
  :global(.no-default-outline) {
    outline: none;
  }
  :global(.no-default-outline:focus-visible) {
    outline: 2px solid var(--theme-accent, #7c6aff);
    outline-offset: 2px;
  }
</style>
