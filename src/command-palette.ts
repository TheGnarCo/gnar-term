import { TerminalManager } from "./terminal-manager";
import { theme, themes, setTheme, activeThemeId, onThemeChange, getXtermTheme } from "./theme";
import { createMarkdownSurface } from "./markdown-viewer";
import { saveConfig, getWorkspaceCommands } from "./config";

interface Command {
  name: string;
  shortcut?: string;
  action: () => void;
}

let overlay: HTMLElement | null = null;

function close() {
  if (overlay) { overlay.remove(); overlay = null; }
}

export function openCommandPalette(manager: TerminalManager) {
  if (overlay) { close(); return; }

  const commands: Command[] = [
    { name: "New Workspace", shortcut: "⌘N", action: () => manager.createWorkspace(`Workspace ${manager.workspaces.length + 1}`) },
    { name: "New Surface (Tab)", shortcut: "⌘T", action: () => manager.newSurface() },
    { name: "Split Right", shortcut: "⌘D", action: () => manager.splitPane("horizontal") },
    { name: "Split Down", shortcut: "⇧⌘D", action: () => manager.splitPane("vertical") },
    { name: "Close Surface", shortcut: "⌘W", action: () => manager.closeSurface() },
    { name: "Close Workspace", shortcut: "⇧⌘W", action: () => manager.closeActiveWorkspace() },
    { name: "Toggle Pane Zoom", shortcut: "⇧⌘Enter", action: () => manager.togglePaneZoom() },
    { name: "Flash Focused Pane", shortcut: "⇧⌘H", action: () => manager.flashFocusedPane() },
    { name: "Next Surface", shortcut: "⌘⇧]", action: () => manager.nextSurface() },
    { name: "Previous Surface", shortcut: "⌘⇧[", action: () => manager.prevSurface() },
    { name: "Toggle Sidebar", shortcut: "⌘B", action: () => {
      const el = document.getElementById("sidebar");
      if (el) el.style.display = el.style.display === "none" ? "flex" : "none";
    }},
    ...manager.workspaces.map((ws, i) => ({
      name: `Switch to: ${ws.name}`,
      shortcut: i < 9 ? `⌘${i + 1}` : undefined,
      action: () => manager.switchWorkspace(i),
    })),
    { name: "Open Markdown File...", action: async () => {
      const path = prompt("Path to .md file:");
      if (path) manager.openMarkdown(path);
    }},
    // Workspace commands from config
    ...getWorkspaceCommands().map((cmd) => ({
      name: cmd.name,
      action: () => {
        if (cmd.workspace) {
          manager.createWorkspaceFromDef(cmd.workspace);
        }
      },
    })),
    // Theme selection
    ...Object.entries(themes).map(([id, t]) => ({
      name: `Theme: ${t.name}${id === activeThemeId() ? " ✓" : ""}`,
      action: () => {
        setTheme(id);
        // Update all terminal themes
        for (const ws of manager.workspaces) {
          for (const s of manager.getAllSurfaces(ws)) {
            if (s.terminal) s.terminal.options.theme = getXtermTheme();
          }
        }
        // Re-layout to pick up new chrome colors
        manager.refreshLayout();
        // Persist to config file
        saveConfig({ theme: id });
      },
    })),
  ];

  overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9998;
    background: rgba(0,0,0,0.5); display: flex;
    justify-content: center; padding-top: 80px;
  `;

  const panel = document.createElement("div");
  panel.style.cssText = `
    width: 500px; max-height: 400px; background: ${theme.bgFloat};
    border: 1px solid ${theme.border}; border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.6);
    display: flex; flex-direction: column; overflow: hidden;
  `;

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type a command...";
  input.style.cssText = `
    padding: 14px 18px; background: transparent; border: none;
    border-bottom: 1px solid ${theme.border}; color: ${theme.fg};
    font-size: 15px; outline: none; font-family: inherit;
  `;

  const list = document.createElement("div");
  list.style.cssText = "flex: 1; overflow-y: auto; padding: 4px 0;";

  let selectedIdx = 0;
  let filtered = [...commands];
  let rows: HTMLElement[] = [];

  function updateSelection() {
    rows.forEach((row, i) => {
      row.style.background = i === selectedIdx ? theme.bgHighlight : "transparent";
    });
    // Scroll selected into view
    if (rows[selectedIdx]) rows[selectedIdx].scrollIntoView({ block: "nearest" });
  }

  function render() {
    list.innerHTML = "";
    rows = [];
    filtered.forEach((cmd, i) => {
      const row = document.createElement("div");
      row.style.cssText = `
        padding: 8px 18px; cursor: pointer; display: flex;
        align-items: center; justify-content: space-between;
        background: transparent;
        color: ${theme.fg}; font-size: 13px;
      `;

      const label = document.createElement("span");
      label.textContent = cmd.name;
      row.appendChild(label);

      if (cmd.shortcut) {
        const sc = document.createElement("span");
        sc.textContent = cmd.shortcut;
        sc.style.cssText = `font-size: 11px; color: ${theme.fgDim};`;
        row.appendChild(sc);
      }

      row.addEventListener("mouseenter", () => { selectedIdx = i; updateSelection(); });
      row.addEventListener("click", () => { close(); cmd.action(); });
      list.appendChild(row);
      rows.push(row);
    });
    updateSelection();
  }

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();
    filtered = commands.filter((c) => c.name.toLowerCase().includes(q));
    selectedIdx = 0;
    render();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1); updateSelection(); }
    if (e.key === "ArrowUp") { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); updateSelection(); }
    if (e.key === "Enter" && filtered[selectedIdx]) { close(); filtered[selectedIdx].action(); }
  });

  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });

  panel.appendChild(input);
  panel.appendChild(list);
  overlay.appendChild(panel);
  // Stop xterm.js from stealing focus
  overlay.addEventListener("keydown", (e) => e.stopPropagation(), true);
  
  document.body.appendChild(overlay);
  render();
  
  // Aggressively grab focus
  input.focus();
  requestAnimationFrame(() => input.focus());
}
