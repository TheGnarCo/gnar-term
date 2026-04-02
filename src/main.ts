import { Sidebar } from "./sidebar";
import { TerminalManager } from "./terminal-manager";

const app = document.getElementById("app")!;

// Layout: sidebar + terminal area
const sidebar = document.createElement("div");
sidebar.id = "sidebar";
sidebar.style.cssText = `
  width: 240px; min-width: 200px; max-width: 400px;
  background: #111; border-right: 1px solid #222;
  display: flex; flex-direction: column; overflow: hidden;
  font-size: 13px; user-select: none;
`;

const terminalArea = document.createElement("div");
terminalArea.id = "terminal-area";
terminalArea.style.cssText = `
  flex: 1; display: flex; flex-direction: column;
  background: #0a0a0a; min-width: 0;
`;

app.appendChild(sidebar);
app.appendChild(terminalArea);

// Initialize
const termManager = new TerminalManager(terminalArea);
const sidebarUI = new Sidebar(sidebar, termManager);

// Create first workspace
termManager.createWorkspace("Workspace 1");
sidebarUI.refresh();

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const isMeta = e.metaKey || e.ctrlKey;

  // Cmd+N — new workspace
  if (isMeta && e.key === "n" && !e.shiftKey) {
    e.preventDefault();
    const name = `Workspace ${termManager.workspaces.length + 1}`;
    termManager.createWorkspace(name);
    sidebarUI.refresh();
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
    sidebarUI.refresh();
  }

  // Cmd+Shift+W — close workspace
  if (isMeta && e.key === "w" && e.shiftKey) {
    e.preventDefault();
    termManager.closeActiveWorkspace();
    sidebarUI.refresh();
  }

  // Cmd+1-9 — jump to workspace
  if (isMeta && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const idx = e.key === "9" ? termManager.workspaces.length - 1 : parseInt(e.key) - 1;
    termManager.switchWorkspace(idx);
    sidebarUI.refresh();
  }

  // Cmd+B — toggle sidebar
  if (isMeta && e.key === "b") {
    e.preventDefault();
    sidebar.style.display = sidebar.style.display === "none" ? "flex" : "none";
  }
});
