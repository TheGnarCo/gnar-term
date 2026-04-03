import { Sidebar } from "./sidebar";
import { TerminalManager, fontReady } from "./terminal-manager";
import { openCommandPalette } from "./command-palette";
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

const terminalArea = document.createElement("div");
terminalArea.id = "terminal-area";
terminalArea.style.cssText = `
  flex: 1; display: flex; flex-direction: column;
  background: ${theme.bg}; min-width: 0;
`;

// Sidebar toggle button (always visible, lives outside the sidebar)
const sidebarToggle = document.createElement("button");
sidebarToggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="2" width="14" height="12" rx="1.5"/><line x1="5.5" y1="2" x2="5.5" y2="14"/></svg>`;
sidebarToggle.title = "Toggle Sidebar (⌘B)";
sidebarToggle.style.cssText = `
  position: fixed; top: 8px; left: 8px; z-index: 100;
  background: none; border: none; color: ${theme.fgDim};
  cursor: pointer; width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px; padding: 0;
`;
sidebarToggle.addEventListener("click", () => {
  sidebar.style.display = sidebar.style.display === "none" ? "flex" : "none";
});
sidebarToggle.addEventListener("mouseenter", () => { sidebarToggle.style.background = theme.bgHighlight; sidebarToggle.style.color = theme.fg; });
sidebarToggle.addEventListener("mouseleave", () => { sidebarToggle.style.background = "none"; sidebarToggle.style.color = theme.fgDim; });

app.appendChild(sidebar);
app.appendChild(terminalArea);
document.body.appendChild(sidebarToggle);

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
  terminalArea.style.background = theme.bg;
  document.body.style.background = theme.bg;
});

// Load config, apply theme, then create first workspace
fontReady.then(async () => {
  const config = await loadConfig();
  if (config.theme) {
    setTheme(config.theme);
    sidebar.style.background = theme.sidebarBg;
    sidebar.style.borderColor = theme.sidebarBorder;
    terminalArea.style.background = theme.bg;
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
  const cmd = e.metaKey || (e.ctrlKey && !e.metaKey); // Cmd on Mac, Ctrl on Linux
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

  // ⌘B — Toggle sidebar
  if (cmd && !shift && !alt && e.key === "b") {
    e.preventDefault();
    sidebar.style.display = sidebar.style.display === "none" ? "flex" : "none";
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
});
