import { Sidebar } from "./sidebar";
import { TerminalManager, fontReady } from "./terminal-manager";
import { openCommandPalette } from "./command-palette";
import { toggleFindBar, findNext, findPrev, isFindBarVisible, hideFindBar } from "./find-bar";
import { theme, onThemeChange, setTheme, getXtermTheme } from "./theme";
import { listen } from "@tauri-apps/api/event";
import { loadConfig, saveConfig } from "./config";

const app = document.getElementById("app")!;

// Layout: sidebar + content
const sidebar = document.createElement("div");
sidebar.id = "sidebar";
sidebar.style.cssText = `
  width: 220px; min-width: 180px; max-width: 400px;
  background: ${theme.sidebarBg}; border-right: 1px solid ${theme.sidebarBorder};
  display: flex; flex-direction: column; overflow: hidden;
  font-size: 13px; user-select: none;
`;

// Wrapper holds the drag region + terminal area in a column
const terminalWrapper = document.createElement("div");
terminalWrapper.style.cssText = `
  flex: 1; display: flex; flex-direction: column;
  background: ${theme.bg}; min-height: 0; min-width: 0;
`;

// Title bar drag region above terminal area (matches sidebar header height)
const titleBarDrag = document.createElement("div");
titleBarDrag.setAttribute("data-tauri-drag-region", "");
titleBarDrag.style.cssText = `
  height: 38px; flex-shrink: 0; display: flex; align-items: center;
  padding-left: 16px;
  -webkit-app-region: drag;
`;
const titleLabel = document.createElement("span");
titleLabel.textContent = "GNARTERM";
titleLabel.style.cssText = `
  font-size: 11px; font-weight: 600; letter-spacing: 1.5px;
  color: ${theme.fgDim}; pointer-events: none;
`;
titleBarDrag.appendChild(titleLabel);
terminalWrapper.appendChild(titleBarDrag);

const terminalArea = document.createElement("div");
terminalArea.id = "terminal-area";
terminalArea.style.cssText = `
  flex: 1; display: flex; flex-direction: column;
  min-height: 0; min-width: 0;
`;
terminalWrapper.appendChild(terminalArea);

// Sidebar toggle — only visible when sidebar is hidden
const sidebarToggle = document.createElement("button");
sidebarToggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="2" width="14" height="12" rx="1.5"/><line x1="5.5" y1="2" x2="5.5" y2="14"/></svg>`;
sidebarToggle.id = "sidebar-toggle";
sidebarToggle.title = "Show Sidebar (⌘B)";
sidebarToggle.style.cssText = `
  background: none; border: none; border-right: 1px solid ${theme.border};
  color: ${theme.fgDim}; cursor: pointer; width: 36px;
  display: none; align-items: center; justify-content: center;
  padding: 38px 0 0 0; flex-shrink: 0; align-self: stretch;
`;
sidebarToggle.addEventListener("click", () => {
  sidebar.style.display = "flex";
  sidebarToggle.style.display = "none";
});
sidebarToggle.addEventListener("mouseenter", () => { sidebarToggle.style.background = theme.bgHighlight; sidebarToggle.style.color = theme.fg; });
sidebarToggle.addEventListener("mouseleave", () => { sidebarToggle.style.background = "none"; sidebarToggle.style.color = theme.fgDim; });

app.appendChild(sidebar);
app.appendChild(sidebarToggle);
app.appendChild(terminalWrapper);

const termManager = new TerminalManager(terminalArea);
const sidebarUI = new Sidebar(sidebar, termManager);

// Handle theme selection from native menu
listen<string>("menu-theme", (event) => {
  const id = event.payload.replace("theme-", "");
  setTheme(id);
  for (const ws of termManager.workspaces) {
    for (const s of termManager.getAllSurfaces(ws)) {
      if (s.terminal) s.terminal.options.theme = getXtermTheme();
    }
  }
  termManager.refreshLayout();
  saveConfig({ theme: id });
});

listen("menu-cmd-palette", () => {
  openCommandPalette(termManager);
});

// Update chrome colors on theme change
onThemeChange(() => {
  sidebar.style.background = theme.sidebarBg;
  sidebar.style.borderColor = theme.sidebarBorder;
  terminalWrapper.style.background = theme.bg;
  titleLabel.style.color = theme.fgDim;
  document.body.style.background = theme.bg;
});

// Load config, apply theme, then create first workspace
fontReady.then(async () => {
  const config = await loadConfig();
  if (config.theme) {
    setTheme(config.theme);
    sidebar.style.background = theme.sidebarBg;
    sidebar.style.borderColor = theme.sidebarBorder;
    terminalWrapper.style.background = theme.bg;
    document.body.style.background = theme.bg;
  }
  // Autoload workspace commands from config
  const autoload = config.autoload || [];
  const commands = config.commands || [];
  let launched = false;
  for (const name of autoload) {
    const cmd = commands.find(c => c.name === name && c.workspace);
    if (cmd?.workspace) {
      await termManager.createWorkspaceFromDef(cmd.workspace);
      launched = true;
    }
  }
  // If nothing autoloaded, create a default workspace
  if (!launched) {
    await termManager.createWorkspace("Workspace 1");
  }
  sidebarUI.refresh();
});

// --- Keyboard Shortcuts (cmux-compatible) ---

document.addEventListener("keydown", (e) => {
  const cmd = e.metaKey; // Only Meta/Cmd key — never Ctrl (Ctrl+L, Ctrl+C etc. must reach terminal)
  const shift = e.shiftKey;
  const alt = e.altKey;
  const ctrl = e.ctrlKey;

  // ⌘N — New workspace
  if (cmd && !shift && !alt && e.key === "n") {
    e.preventDefault();
    termManager.createWorkspace(`Workspace ${termManager.workspaces.length + 1}`);
    return;
  }

  // ⌘T — New surface (tab in current pane)
  if (cmd && !shift && !alt && e.key === "t") {
    e.preventDefault();
    termManager.newSurface();
    return;
  }

  // ⌘D — Split right
  if (cmd && !shift && !alt && e.key === "d") {
    e.preventDefault();
    termManager.splitPane("horizontal");
    return;
  }

  // ⇧⌘D — Split down
  if (cmd && shift && !alt && e.key === "d") {
    e.preventDefault();
    termManager.splitPane("vertical");
    return;
  }

  // ⌘W — Close surface
  if (cmd && !shift && !alt && e.key === "w") {
    e.preventDefault();
    termManager.closeSurface();
    return;
  }

  // ⇧⌘W — Close workspace
  if (cmd && shift && !alt && e.key === "w") {
    e.preventDefault();
    termManager.closeActiveWorkspace();
    return;
  }

  // ⌘1-8 — Select workspace by number
  if (cmd && !shift && !alt && !ctrl && e.key >= "1" && e.key <= "8") {
    e.preventDefault();
    termManager.switchWorkspace(parseInt(e.key) - 1);
    return;
  }

  // ⌘9 — Last workspace
  if (cmd && !shift && !alt && !ctrl && e.key === "9") {
    e.preventDefault();
    termManager.switchWorkspace(termManager.workspaces.length - 1);
    return;
  }

  // ⌃1-8 — Select surface by number
  if (ctrl && !cmd && !shift && !alt && e.key >= "1" && e.key <= "8") {
    e.preventDefault();
    termManager.selectSurface(parseInt(e.key));
    return;
  }

  // ⌃9 — Last surface
  if (ctrl && !cmd && !shift && !alt && e.key === "9") {
    e.preventDefault();
    termManager.selectSurface(9);
    return;
  }

  // ⌃⌘] — Next workspace
  if (ctrl && cmd && e.key === "]") {
    e.preventDefault();
    const next = (termManager.activeWorkspaceIdx + 1) % termManager.workspaces.length;
    termManager.switchWorkspace(next);
    return;
  }

  // ⌃⌘[ — Previous workspace
  if (ctrl && cmd && e.key === "[") {
    e.preventDefault();
    const prev = (termManager.activeWorkspaceIdx - 1 + termManager.workspaces.length) % termManager.workspaces.length;
    termManager.switchWorkspace(prev);
    return;
  }

  // ⌘⇧] — Next surface
  if (cmd && shift && e.key === "]") {
    e.preventDefault();
    termManager.nextSurface();
    return;
  }

  // ⌘⇧[ — Previous surface
  if (cmd && shift && e.key === "[") {
    e.preventDefault();
    termManager.prevSurface();
    return;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
  if (ctrl && !cmd && !alt && e.key === "Tab") {
    e.preventDefault();
    if (shift) termManager.prevSurface();
    else termManager.nextSurface();
    return;
  }

  // ⌘B — Toggle sidebar
  if (cmd && !shift && !alt && e.key === "b") {
    e.preventDefault();
    const hidden = sidebar.style.display === "none";
    sidebar.style.display = hidden ? "flex" : "none";
    sidebarToggle.style.display = hidden ? "none" : "flex";
    return;
  }

  // ⌥⌘← — Focus pane left
  if (alt && cmd && e.key === "ArrowLeft") { e.preventDefault(); termManager.focusDirection("left"); return; }
  // ⌥⌘→ — Focus pane right
  if (alt && cmd && e.key === "ArrowRight") { e.preventDefault(); termManager.focusDirection("right"); return; }
  // ⌥⌘↑ — Focus pane up
  if (alt && cmd && e.key === "ArrowUp") { e.preventDefault(); termManager.focusDirection("up"); return; }
  // ⌥⌘↓ — Focus pane down
  if (alt && cmd && e.key === "ArrowDown") { e.preventDefault(); termManager.focusDirection("down"); return; }

  // ⇧⌘Enter — Toggle pane zoom
  if (cmd && shift && e.key === "Enter") {
    e.preventDefault();
    termManager.togglePaneZoom();
    return;
  }

  // ⇧⌘H — Flash focused panel
  if (cmd && shift && e.key === "h") {
    e.preventDefault();
    termManager.flashFocusedPane();
    return;
  }

  // ⇧⌘R — Rename workspace
  if (cmd && shift && e.key === "r") {
    e.preventDefault();
    const sidebarItems = document.querySelectorAll("#sidebar > div:nth-child(2) > div");
    const activeItem = sidebarItems[termManager.activeWorkspaceIdx] as any;
    if (activeItem && activeItem.startRename) {
      activeItem.startRename();
    }
    return;
  }

  // ⌘P — Command palette
  if (cmd && !shift && !alt && e.key === "p") {
    e.preventDefault();
    openCommandPalette(termManager);
    return;
  }

  // ⌘F — Toggle find bar
  if (cmd && !shift && !alt && e.key === "f") {
    e.preventDefault();
    toggleFindBar(termManager);
    return;
  }

  // ⌘G — Find next
  if (cmd && !shift && !alt && e.key === "g") {
    e.preventDefault();
    findNext();
    return;
  }

  // ⇧⌘G — Find previous
  if (cmd && shift && !alt && e.key === "g") {
    e.preventDefault();
    findPrev();
    return;
  }

  // Escape — Close find bar (when visible and focus is not in terminal)
  if (e.key === "Escape" && isFindBarVisible()) {
    e.preventDefault();
    hideFindBar();
    return;
  }
});
