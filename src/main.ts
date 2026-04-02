import { Sidebar } from "./sidebar";
import { TabBar } from "./tab-bar";
import { TerminalManager } from "./terminal-manager";
import { openCommandPalette } from "./command-palette";
import { theme } from "./theme";

const app = document.getElementById("app")!;

// Layout: sidebar + terminal area
const sidebar = document.createElement("div");
sidebar.id = "sidebar";
sidebar.style.cssText = `
  width: 220px; min-width: 180px; max-width: 400px;
  background: ${theme.sidebarBg}; border-right: 1px solid ${theme.sidebarBorder};
  display: flex; flex-direction: column; overflow: hidden;
  font-size: 13px; user-select: none;
`;

const rightPanel = document.createElement("div");
rightPanel.style.cssText = "flex: 1; display: flex; flex-direction: column; min-width: 0;";

const tabBarEl = document.createElement("div");
tabBarEl.id = "tab-bar";

const terminalArea = document.createElement("div");
terminalArea.id = "terminal-area";
terminalArea.style.cssText = `
  flex: 1; display: flex; flex-direction: column;
  background: ${theme.bg}; min-width: 0;
`;

rightPanel.appendChild(tabBarEl);
rightPanel.appendChild(terminalArea);

app.appendChild(sidebar);
app.appendChild(rightPanel);

// Initialize
const termManager = new TerminalManager(terminalArea);
const sidebarUI = new Sidebar(sidebar, termManager);
const tabBar = new TabBar(tabBarEl, termManager);

// Create first workspace
termManager.createWorkspace("Workspace 1");
sidebarUI.refresh();
tabBar.refresh();

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const isMeta = e.metaKey || e.ctrlKey;
  const isAlt = e.altKey;

  // Cmd+N — new workspace
  if (isMeta && e.key === "n" && !e.shiftKey) {
    e.preventDefault();
    const name = `Workspace ${termManager.workspaces.length + 1}`;
    termManager.createWorkspace(name);
  }

  // Cmd+D — split right
  if (isMeta && e.key === "d" && !e.shiftKey) {
    e.preventDefault();
    termManager.splitPane("right");
  }

  // Cmd+Shift+D — split down
  if (isMeta && e.key === "d" && e.shiftKey) {
    e.preventDefault();
    termManager.splitPane("down");
  }

  // Cmd+W — close pane
  if (isMeta && e.key === "w" && !e.shiftKey) {
    e.preventDefault();
    termManager.closeActivePane();
  }

  // Cmd+Shift+W — close workspace
  if (isMeta && e.key === "w" && e.shiftKey) {
    e.preventDefault();
    termManager.closeActiveWorkspace();
  }

  // Cmd+1-9 — jump to workspace
  if (isMeta && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const idx = e.key === "9" ? termManager.workspaces.length - 1 : parseInt(e.key) - 1;
    termManager.switchWorkspace(idx);
  }

  // Cmd+B — toggle sidebar
  if (isMeta && e.key === "b") {
    e.preventDefault();
    sidebar.style.display = sidebar.style.display === "none" ? "flex" : "none";
  }

  // Alt+Cmd+Arrow — focus pane directionally
  if (isAlt && isMeta) {
    if (e.key === "ArrowLeft") { e.preventDefault(); termManager.focusDirection("left"); }
    if (e.key === "ArrowRight") { e.preventDefault(); termManager.focusDirection("right"); }
    if (e.key === "ArrowUp") { e.preventDefault(); termManager.focusDirection("up"); }
    if (e.key === "ArrowDown") { e.preventDefault(); termManager.focusDirection("down"); }
  }

  // Cmd+P — command palette
  if (isMeta && e.key === "p") {
    e.preventDefault();
    openCommandPalette(termManager);
  }

  // Ctrl+Tab / Ctrl+Shift+Tab — next/prev workspace
  if (e.ctrlKey && e.key === "Tab") {
    e.preventDefault();
    const dir = e.shiftKey ? -1 : 1;
    const next = (termManager.activeWorkspaceIdx + dir + termManager.workspaces.length) % termManager.workspaces.length;
    termManager.switchWorkspace(next);
  }
});
