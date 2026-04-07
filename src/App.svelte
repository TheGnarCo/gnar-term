<script lang="ts">
  import { onMount, tick } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { theme, themes, xtermTheme } from "./lib/stores/theme";
  import { sidebarVisible, commandPaletteOpen, findBarVisible, pendingAction, showInputPrompt } from "./lib/stores/ui";
  import { workspaces, activeWorkspaceIdx, activeWorkspace, activePane, activeSurface } from "./lib/stores/workspace";
  import { invoke } from "@tauri-apps/api/core";
  import { loadConfig, saveConfig, getConfig, getWorkspaceCommands, type WorkspaceDef, type LayoutNode } from "./lib/config";
  import { setupListeners, createTerminalSurface, fontReady, startCwdPolling, isMac, modLabel, shiftModLabel } from "./lib/terminal-service";
  import { uid, getAllPanes, getAllSurfaces, isTerminalSurface, findParentSplit, replaceNodeInTree, type Workspace, type Pane, type SplitNode, type Surface, type TerminalSurface as TermSurface } from "./lib/types";
  import { openPreview, canPreview, getSupportedExtensions, refreshPreviewStyles } from "./preview/index";
  import "./preview/init";
  import { type ThemeDef } from "./lib/theme-data";

  import Sidebar from "./lib/components/Sidebar.svelte";
  import SidebarToggle from "./lib/components/SidebarToggle.svelte";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import WorkspaceView from "./lib/components/WorkspaceView.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import FindBar from "./lib/components/FindBar.svelte";
  import ContextMenu from "./lib/components/ContextMenu.svelte";
  import InputPrompt from "./lib/components/InputPrompt.svelte";

  let sidebarComponent: Sidebar;
  let findBarComponent: FindBar;

  // ---- Shared helpers ----

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

  // ---- Workspace service functions ----

  async function safeFocus(s: Surface | null | undefined) {
    if (!s || !isTerminalSurface(s)) return;
    await tick(); // Wait for Svelte DOM update
    s.terminal.focus();
  }

  async function createWorkspace(name: string) {
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    const ws: Workspace = {
      id: uid(), name,
      splitRoot: { type: "pane", pane },
      activePaneId: pane.id,
    };

    // createTerminalSurface already pushes to pane.surfaces and sets activeSurfaceId
    const surface = await createTerminalSurface(pane);

    workspaces.update(list => [...list, ws]);
    activeWorkspaceIdx.set($workspaces.length - 1);
    safeFocus(surface);
  }

  async function createWorkspaceFromDef(def: WorkspaceDef) {
    const wsName = def.name || `Workspace ${$workspaces.length + 1}`;
    const rootCwd = def.cwd;

    async function buildTree(nodeDef: LayoutNode, inheritedCwd?: string): Promise<SplitNode> {
      if ("pane" in nodeDef) {
        const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
        for (const sDef of nodeDef.pane.surfaces) {
          const cwd = sDef.cwd || inheritedCwd;
          if (sDef.type === "markdown" && sDef.path) {
            const preview = await openPreview(sDef.path);
            const surface = {
              kind: "preview" as const,
              id: preview.id, filePath: preview.filePath,
              title: sDef.name || preview.title,
              element: preview.element, watchId: preview.watchId,
              hasUnread: false,
            };
            pane.surfaces.push(surface);
            if (!pane.activeSurfaceId || sDef.focus) pane.activeSurfaceId = surface.id;
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
        return { type: "split", direction: nodeDef.direction, ratio: nodeDef.split || 0.5, children: [left, right] };
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
      id: uid(), name: wsName, splitRoot,
      activePaneId: getAllPanes(splitRoot)[0]?.id ?? null,
    };

    workspaces.update(list => [...list, ws]);
    activeWorkspaceIdx.set($workspaces.length - 1);
    const ap = getAllPanes(splitRoot).find(p => p.id === ws.activePaneId);
    const as_ = ap?.surfaces.find(s => s.id === ap.activeSurfaceId);
    safeFocus(as_);
  }

  function switchWorkspace(idx: number) {
    if (idx < 0 || idx >= $workspaces.length) return;
    activeWorkspaceIdx.set(idx);
    // fit() and scrollToBottom() are handled by TerminalSurface's visibility transition.
    // Just need to set focus after the transition settles.
    safeFocus($activeSurface);
  }

  function closeWorkspace(idx: number) {
    if ($workspaces.length <= 1) return;
    const ws = $workspaces[idx];
    for (const pane of getAllPanes(ws.splitRoot)) {
      pane.resizeObserver?.disconnect();
    }
    for (const s of getAllSurfaces(ws)) {
      if (isTerminalSurface(s)) {
        s.terminal.dispose();
        if (s.ptyId >= 0) {
          invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
        }
      }
    }
    workspaces.update(list => list.filter((_, i) => i !== idx));
    activeWorkspaceIdx.set(Math.min($activeWorkspaceIdx, $workspaces.length - 1));
  }

  function renameWorkspace(idx: number, name: string) {
    workspaces.update(list => {
      list[idx].name = name;
      return [...list];
    });
  }

  function reorderWorkspaces(fromIdx: number, toIdx: number) {
    workspaces.update(list => {
      const item = list.splice(fromIdx, 1)[0];
      const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
      list.splice(adjustedTo, 0, item);
      return [...list];
    });
    if ($activeWorkspaceIdx === fromIdx) {
      activeWorkspaceIdx.set(fromIdx < toIdx ? toIdx - 1 : toIdx);
    }
  }

  // ---- Pane/Surface service functions ----

  function handleSelectSurface(paneId: string, surfaceId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = getAllPanes(ws.splitRoot).find(p => p.id === paneId);
    if (!pane) return;
    pane.activeSurfaceId = surfaceId;
    const s = pane.surfaces.find(s => s.id === surfaceId);
    if (s) s.hasUnread = false;
    workspaces.update(l => [...l]);
    safeFocus(s);
  }

  function handleCloseSurface(paneId: string, surfaceId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = getAllPanes(ws.splitRoot).find(p => p.id === paneId);
    if (!pane) return;
    const idx = pane.surfaces.findIndex(s => s.id === surfaceId);
    if (idx < 0) return;
    removeSurface(ws, pane, idx);
  }

  function removeSurface(ws: Workspace, pane: Pane, surfaceIdx: number) {
    const surface = pane.surfaces[surfaceIdx];
    if (isTerminalSurface(surface)) {
      surface.terminal.dispose();
      if (surface.ptyId >= 0) {
        invoke("kill_pty", { ptyId: surface.ptyId }).catch(() => {});
      }
    }
    pane.surfaces.splice(surfaceIdx, 1);

    if (pane.surfaces.length === 0) {
      removePane(ws, pane);
    } else {
      pane.activeSurfaceId = pane.surfaces[Math.min(surfaceIdx, pane.surfaces.length - 1)].id;
      workspaces.update(l => [...l]);
      const s = pane.surfaces.find(s => s.id === pane.activeSurfaceId);
      safeFocus(s);
    }
  }

  /** Get the CWD of the active terminal surface, querying the PTY if needed. */
  async function getActiveCwd(): Promise<string | undefined> {
    if (!$activeSurface || !isTerminalSurface($activeSurface)) return undefined;
    if ($activeSurface.cwd) return $activeSurface.cwd;
    if ($activeSurface.ptyId >= 0) {
      try {
        return await invoke<string>("get_pty_cwd", { ptyId: $activeSurface.ptyId }) || undefined;
      } catch { return undefined; }
    }
    return undefined;
  }

  async function handleNewSurface(paneId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = getAllPanes(ws.splitRoot).find(p => p.id === paneId);
    if (!pane) return;
    const cwd = await getActiveCwd();
    const surface = await createTerminalSurface(pane, cwd);
    workspaces.update(l => [...l]);
    safeFocus(surface);
  }

  // findParentSplit and replaceNodeInTree imported from types.ts

  async function handleSplitPane(paneId: string, direction: "horizontal" | "vertical") {
    const ws = $activeWorkspace;
    if (!ws) return;
    const activeP = getAllPanes(ws.splitRoot).find(p => p.id === paneId) ?? $activePane;
    if (!activeP) return;

    const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    const cwd = await getActiveCwd();
    const surface = await createTerminalSurface(newPane, cwd);

    const newSplit: SplitNode = {
      type: "split", direction,
      children: [{ type: "pane", pane: activeP }, { type: "pane", pane: newPane }],
      ratio: 0.5,
    };

    if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === activeP.id) {
      ws.splitRoot = newSplit;
    } else {
      const parentInfo = findParentSplit(ws.splitRoot, activeP.id);
      if (parentInfo && parentInfo.parent.type === "split") {
        parentInfo.parent.children[parentInfo.index] = newSplit;
      }
    }
    ws.activePaneId = newPane.id;
    workspaces.update(l => [...l]);
    safeFocus(surface);
  }

  function removePane(ws: Workspace, pane: Pane) {
    pane.resizeObserver?.disconnect();
    if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === pane.id) {
      const wsIdx = $workspaces.indexOf(ws);
      workspaces.update(list => list.filter(w => w.id !== ws.id));
      if ($workspaces.length === 0) {
        createWorkspace("Workspace 1");
      } else {
        activeWorkspaceIdx.set(Math.min(wsIdx, $workspaces.length - 1));
      }
      return;
    }
    const parentInfo = findParentSplit(ws.splitRoot, pane.id);
    if (parentInfo && parentInfo.parent.type === "split") {
      const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
      if (ws.splitRoot === parentInfo.parent) {
        ws.splitRoot = sibling;
      } else {
        replaceNodeInTree(ws.splitRoot, parentInfo.parent, sibling);
      }
      ws.activePaneId = getAllPanes(ws.splitRoot)[0]?.id ?? null;
    }
    workspaces.update(l => [...l]);
    safeFocus($activeSurface);
  }

  function handleClosePane(paneId: string) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = getAllPanes(ws.splitRoot).find(p => p.id === paneId);
    if (!pane) return;
    for (const s of [...pane.surfaces]) {
      if (isTerminalSurface(s)) {
        s.terminal.dispose();
        if (s.ptyId >= 0) invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
      }
    }
    pane.surfaces = [];
    removePane(ws, pane);
  }

  function handleFocusPane(paneId: string) {
    const ws = $activeWorkspace;
    if (!ws || ws.activePaneId === paneId) return;
    ws.activePaneId = paneId;
    workspaces.update(l => [...l]);
  }

  function handleReorderTab(paneId: string, fromIdx: number, toIdx: number) {
    const ws = $activeWorkspace;
    if (!ws) return;
    const pane = getAllPanes(ws.splitRoot).find(p => p.id === paneId);
    if (!pane || fromIdx === toIdx) return;
    const item = pane.surfaces.splice(fromIdx, 1)[0];
    const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
    pane.surfaces.splice(adjustedTo, 0, item);
    workspaces.update(l => [...l]);
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
    const currentIdx = panes.findIndex(p => p.id === ws.activePaneId);
    const nextIdx = (dir === "right" || dir === "down")
      ? (currentIdx + 1) % panes.length
      : (currentIdx - 1 + panes.length) % panes.length;
    ws.activePaneId = panes[nextIdx].id;
    workspaces.update(l => [...l]);
    const s = panes[nextIdx].surfaces.find(s => s.id === panes[nextIdx].activeSurfaceId);
    safeFocus(s);
  }

  // ---- Pane zoom ----
  let zoomedPaneId: string | null = null;

  function togglePaneZoom() {
    const ws = $activeWorkspace;
    if (!ws) return;
    zoomedPaneId = zoomedPaneId ? null : ws.activePaneId;
    workspaces.update(l => [...l]);
    // ResizeObserver handles fit() when the pane size changes.
    safeFocus($activeSurface);
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
      setTimeout(() => { el.style.transition = ""; }, 300);
    }, 400);
  }

  // ---- Workspace serialization ----
  function serializeLayout(node: SplitNode): LayoutNode {
    if (node.type === "pane") {
      const surfaces = node.pane.surfaces.map(s => {
        const def: any = { type: isTerminalSurface(s) ? "terminal" : "markdown" };
        if (s.title) def.name = s.title;
        if (isTerminalSurface(s) && s.cwd) def.cwd = s.cwd;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        if (!isTerminalSurface(s) && "filePath" in s) def.path = s.filePath;
        return def;
      });
      return { pane: { surfaces } };
    }
    return {
      direction: node.direction,
      split: node.ratio,
      children: [serializeLayout(node.children[0]), serializeLayout(node.children[1])],
    };
  }

  async function saveCurrentWorkspace() {
    const ws = $activeWorkspace;
    if (!ws) return;
    const name = await showInputPrompt("Workspace name", ws.name);
    if (!name) return;
    const layout = serializeLayout(ws.splitRoot);
    const activeCwd = $activeSurface && isTerminalSurface($activeSurface) ? $activeSurface.cwd : undefined;
    const wsDef: WorkspaceDef = { name, cwd: activeCwd || "~", layout };
    const config = getConfig();
    const commands = config.commands || [];
    const existing = commands.findIndex(c => c.name === name);
    const entry = { name, workspace: wsDef };
    if (existing >= 0) {
      commands[existing] = entry;
    } else {
      commands.push(entry);
    }
    await saveConfig({ commands });
  }

  // ---- Command palette commands ----
  $: paletteCommands = [
    { name: "New Workspace", shortcut: `${shiftModLabel}N`, action: () => createWorkspace(`Workspace ${$workspaces.length + 1}`) },
    { name: "New Surface (Tab)", shortcut: `${shiftModLabel}T`, action: () => handleNewSurfaceFromSidebar() },
    { name: "Split Right", shortcut: isMac ? `${modLabel}D` : `${shiftModLabel}D`, action: () => handleSplitFromSidebar("horizontal") },
    { name: "Split Down", shortcut: `${shiftModLabel}D`, action: () => handleSplitFromSidebar("vertical") },
    { name: "Close Surface", shortcut: isMac ? `${modLabel}W` : `${shiftModLabel}W`, action: () => closeSurface() },
    { name: "Close Workspace", shortcut: `${shiftModLabel}W`, action: () => closeWorkspace($activeWorkspaceIdx) },
    { name: "Toggle Pane Zoom", shortcut: `${shiftModLabel}Enter`, action: () => togglePaneZoom() },
    { name: "Next Surface", shortcut: `${shiftModLabel}]`, action: () => nextSurface() },
    { name: "Previous Surface", shortcut: `${shiftModLabel}[`, action: () => prevSurface() },
    { name: "Toggle Sidebar", shortcut: `${shiftModLabel}B`, action: () => sidebarVisible.update(v => !v) },
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

  async function openPreviewInPane(filePath: string) {
    const ws = $activeWorkspace;
    const pane = $activePane;
    if (!ws || !pane) return;
    const preview = await openPreview(filePath);
    const surface = {
      kind: "preview" as const,
      id: preview.id,
      filePath: preview.filePath,
      title: preview.title,
      element: preview.element,
      watchId: preview.watchId,
      hasUnread: false,
    };
    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    workspaces.update(l => [...l]);
  }

  // ---- Pending action consumer (dispatched from terminal-service.ts) ----
  $: if ($pendingAction) {
    const action = $pendingAction;
    pendingAction.set(null);
    if (action.type === "open-preview" && action.payload) {
      openPreviewInPane(action.payload);
    } else if (action.type === "split-right") {
      handleSplitFromSidebar("horizontal");
    } else if (action.type === "split-down") {
      handleSplitFromSidebar("vertical");
    }
  }

  // ---- Next/Prev surface ----
  function nextSurface() {
    const pane = $activePane;
    if (!pane || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex(s => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId = pane.surfaces[(idx + 1) % pane.surfaces.length].id;
    workspaces.update(l => [...l]);
    safeFocus($activeSurface);
  }

  function prevSurface() {
    const pane = $activePane;
    if (!pane || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex(s => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId = pane.surfaces[(idx - 1 + pane.surfaces.length) % pane.surfaces.length].id;
    workspaces.update(l => [...l]);
    safeFocus($activeSurface);
  }

  function selectSurface(num: number) {
    const pane = $activePane;
    if (!pane) return;
    const idx = num === 9 ? pane.surfaces.length - 1 : num - 1;
    if (idx >= 0 && idx < pane.surfaces.length) {
      pane.activeSurfaceId = pane.surfaces[idx].id;
      workspaces.update(l => [...l]);
      safeFocus($activeSurface);
    }
  }

  function closeSurface() {
    const ws = $activeWorkspace;
    const pane = $activePane;
    if (!ws || !pane) return;
    const idx = pane.surfaces.findIndex(s => s.id === pane.activeSurfaceId);
    if (idx < 0) return;
    removeSurface(ws, pane, idx);
  }

  // ---- Keyboard shortcuts ----
  // macOS: Cmd+key for non-shift, Cmd+Shift+key for shift variants
  // Linux: Ctrl+Shift+key for ALL app shortcuts (plain Ctrl+key must pass to PTY)
  function handleKeydown(e: KeyboardEvent) {
    const shift = e.shiftKey;
    const alt = e.altKey;
    const ctrl = e.ctrlKey;

    // Platform-aware "command" modifier:
    // macOS: Cmd (metaKey)
    // Linux: Ctrl+Shift (ctrlKey && shiftKey) for app shortcuts
    const cmd = isMac ? e.metaKey : (ctrl && shift);

    // macOS-only: Cmd+key (no shift) shortcuts
    if (isMac && e.metaKey && !shift && !alt) {
      if (e.key === "n") { e.preventDefault(); createWorkspace(`Workspace ${$workspaces.length + 1}`); return; }
      if (e.key === "t") { e.preventDefault(); handleNewSurfaceFromSidebar(); return; }
      if (e.key === "d") { e.preventDefault(); handleSplitFromSidebar("horizontal"); return; }
      if (e.key === "w") { e.preventDefault(); closeSurface(); return; }
      if (e.key >= "1" && e.key <= "8") { e.preventDefault(); switchWorkspace(parseInt(e.key) - 1); return; }
      if (e.key === "9") { e.preventDefault(); switchWorkspace($workspaces.length - 1); return; }
      if (e.key === "b") { e.preventDefault(); sidebarVisible.update(v => !v); return; }
      if (e.key === "k") { e.preventDefault(); const s = $activeSurface; if (s && isTerminalSurface(s)) s.terminal.clear(); return; }
      if (e.key === "p") { e.preventDefault(); commandPaletteOpen.update(v => !v); return; }
      if (e.key === "f") { e.preventDefault(); findBarVisible.update(v => !v); return; }
      if (e.key === "g") { e.preventDefault(); findBarVisible.set(true); findBarComponent?.findNext(); return; }
    }

    // macOS: Ctrl+number selects surfaces (tabs within pane)
    if (isMac && ctrl && !e.metaKey && !shift && !alt && e.key >= "1" && e.key <= "8") { e.preventDefault(); selectSurface(parseInt(e.key)); return; }
    if (isMac && ctrl && !e.metaKey && !shift && !alt && e.key === "9") { e.preventDefault(); selectSurface(9); return; }

    // Shared Cmd+Shift / Ctrl+Shift shortcuts (work on both platforms)
    if (cmd && shift && !alt) {
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); handleNewSurfaceFromSidebar(); return; }
      if (k === "n") { e.preventDefault(); createWorkspace(`Workspace ${$workspaces.length + 1}`); return; }
      if (k === "d") { e.preventDefault(); handleSplitFromSidebar("vertical"); return; }
      if (k === "w") { e.preventDefault(); closeWorkspace($activeWorkspaceIdx); return; }
      if (k === "h") { e.preventDefault(); flashFocusedPane(); return; }
      if (k === "r") { e.preventDefault(); sidebarComponent?.startRename($activeWorkspaceIdx); return; }
      if (k === "g") { e.preventDefault(); findBarVisible.set(true); findBarComponent?.findPrev(); return; }
      if (k === "b") { e.preventDefault(); sidebarVisible.update(v => !v); return; }
      if (k === "p") { e.preventDefault(); commandPaletteOpen.update(v => !v); return; }
      if (k === "k") { e.preventDefault(); const s = $activeSurface; if (s && isTerminalSurface(s)) s.terminal.clear(); return; }
      if (k === "f") { e.preventDefault(); findBarVisible.update(v => !v); return; }
      if (e.key === "Enter") { e.preventDefault(); togglePaneZoom(); return; }
      if (e.key === "]") { e.preventDefault(); nextSurface(); return; }
      if (e.key === "[") { e.preventDefault(); prevSurface(); return; }
    }

    // Ctrl+Tab / Ctrl+Shift+Tab for tab switching (both platforms)
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

  // ---- Initialization ----
  onMount(async () => {
    await fontReady;
    setupListeners();
    startCwdPolling();

    const config = await loadConfig();
    if (config.theme) {
      theme.set(config.theme);
    }

    // Autoload workspaces from config, or create a default one
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

    // Listen for menu events
    listen<string>("menu-theme", (event) => {
      applyTheme(event.payload.replace("theme-", ""));
    });

    await listen("menu-cmd-palette", () => {
      commandPaletteOpen.update(v => !v);
    });

    await listen("menu-close-tab", () => {
      closeSurface();
    });
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div id="app" style="display: flex; height: 100vh; overflow: hidden;">
  <Sidebar
    bind:this={sidebarComponent}
    onNewWorkspace={() => createWorkspace(`Workspace ${$workspaces.length + 1}`)}
    onSwitchWorkspace={switchWorkspace}
    onCloseWorkspace={closeWorkspace}
    onRenameWorkspace={renameWorkspace}
    onSplitPane={handleSplitFromSidebar}
    onNewSurface={handleNewSurfaceFromSidebar}
    onReorderWorkspaces={reorderWorkspaces}
  />

  <SidebarToggle />

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
          onSelectSurface={handleSelectSurface}
          onCloseSurface={handleCloseSurface}
          onNewSurface={handleNewSurface}
          onSplitRight={(paneId) => handleSplitPane(paneId, "horizontal")}
          onSplitDown={(paneId) => handleSplitPane(paneId, "vertical")}
          onClosePane={handleClosePane}
          onFocusPane={handleFocusPane}
          onReorderTab={handleReorderTab}
        />
      {/each}

      <FindBar bind:this={findBarComponent} />
    </div>
  </div>
</div>

<CommandPalette commands={paletteCommands} />
<ContextMenu />
<InputPrompt />
