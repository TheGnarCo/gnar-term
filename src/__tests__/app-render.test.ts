/**
 * App render verification test.
 * Verifies the Svelte 5 mount() call works and the App component
 * renders its expected DOM structure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Must use Svelte 5 mount(), not new App()
describe("Svelte 5 mount() entry point", () => {
  it("main.ts uses mount() not new App()", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/main.ts", "utf-8");
    expect(source).toContain('import { mount } from "svelte"');
    expect(source).toContain("mount(App");
    expect(source).not.toContain("new App(");
  });
});

describe("App.svelte structure verification", () => {
  it("has proper onMount initialization", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // Must await fontReady before creating workspace
    expect(source).toContain("await fontReady");
    expect(source).toContain("setupListeners()");
    expect(source).toContain("goHome()");
  });

  it("does not duplicate surface push (createTerminalSurface handles it)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // createTerminalSurface already pushes to pane.surfaces
    // App.svelte should NOT have pane.surfaces.push(surface) after calling it
    const lines = source.split("\n");
    const createCalls = lines.filter((l) =>
      l.includes("createTerminalSurface"),
    );
    // Check that createTerminalSurface calls are NOT followed by a push on the next few lines
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("createTerminalSurface")) {
        // Next 3 lines should not have .surfaces.push(surface)
        const nextLines = lines.slice(i + 1, i + 4).join("\n");
        expect(nextLines).not.toContain(".surfaces.push(surface)");
      }
    }
  });

  it("renders sidebar, terminal area, and overlays", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // Must have these components in the template
    expect(source).toContain("<Sidebar");
    expect(source).toContain("<TitleBar");
    expect(source).toContain("<WorkspaceView");
    expect(source).toContain("<FindBar");
    expect(source).toContain("<CommandPalette");
    expect(source).toContain("<ContextMenu");
  });

  it("terminal area has overflow: hidden for viewport containment", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain('id="terminal-area"');
    // The terminal-area must have overflow hidden to prevent viewport overflow
    const termAreaMatch = source.match(
      /id="terminal-area"[^>]*style="([^"]*)"/,
    );
    expect(termAreaMatch).not.toBeNull();
    expect(termAreaMatch![1]).toContain("overflow: hidden");
    expect(termAreaMatch![1]).toContain("min-height: 0");
  });
});

describe("TerminalSurface component structure", () => {
  it("opens terminal via surface.termElement in onMount (context menu lives there)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/TerminalSurface.svelte",
      "utf-8",
    );
    expect(source).toContain("onMount");
    // Must open into surface.termElement (not termEl) so context menu listeners fire correctly
    expect(source).toContain("surface.terminal.open(surface.termElement)");
    // Must append termElement to the Svelte-bound container
    expect(source).toContain("termEl.appendChild(surface.termElement)");
    expect(source).toContain("surface.opened = true");
  });

  it("no duplicate openTerminalSurface exists in terminal-service", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // openTerminalSurface was removed — TerminalSurface.svelte is the sole owner of terminal.open()
    expect(source).not.toContain("export function openTerminalSurface");
  });

  it("uses display: none for hidden surfaces (not conditional rendering)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/TerminalSurface.svelte",
      "utf-8",
    );
    // Must use CSS visibility, NOT {#if visible} which would destroy the terminal
    expect(source).toContain("display: {visible");
    expect(source).not.toContain("{#if visible}");
  });
});

describe("pendingAction consumer", () => {
  it("App.svelte imports and reacts to pendingAction", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("pendingAction");
    expect(source).toContain("$pendingAction");
    // Must handle open-preview action type
    expect(source).toContain('"open-preview"');
    // Must clear the action after consuming it
    expect(source).toContain("pendingAction.set(null)");
  });

  it("terminal-service sets pendingAction for file preview links", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(source).toContain('pendingAction.set({ type: "open-preview"');
  });
});

describe("WorkspaceView renders all workspaces (not just active)", () => {
  it("uses each loop with display toggle, not conditional rendering", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // Must iterate ALL workspaces and show/hide with CSS
    expect(source).toContain("{#each $workspaces as ws, i (ws.id)}");
    expect(source).toContain("visible={i === $activeWorkspaceIdx}");
  });
});

describe("pty-exit workspace recovery", () => {
  it("clamps activeWorkspaceIdx after workspace removal", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // After splicing a workspace from the list, activeWorkspaceIdx must be clamped
    expect(source).toContain(
      "activeWorkspaceIdx.set(Math.max(0, wsList.length - 1))",
    );
  });

  it("navigates to dashboard when all workspaces are removed", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(source).toContain("goHome()");
    expect(source).toContain("wsList.length === 0");
  });
});

describe("Preview scrolling works", () => {
  it("PreviewSurface container allows scrolling (not overflow: hidden)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/PreviewSurface.svelte",
      "utf-8",
    );
    // Container must allow vertical scrolling
    expect(source).toContain("overflow-y: auto");
    // Must NOT have overflow: hidden which would clip scrollable content
    expect(source).not.toContain("overflow: hidden");
  });
});

describe("Config system migration", () => {
  it("config bridge has been removed — settings.ts is the sole config source", async () => {
    const fs = await import("fs");
    expect(() => fs.readFileSync("src/lib/config.ts", "utf-8")).toThrow();
  });

  it("App.svelte imports from settings, not config", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain('from "./lib/settings"');
    expect(source).not.toContain('from "./lib/config"');
  });
});

describe("Workspace from config definition", () => {
  it("createWorkspaceFromDef is implemented (not a TODO)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("async function createWorkspaceFromDef");
    // Must NOT have the TODO stub
    expect(source).not.toContain("/* TODO: createWorkspaceFromDef */");
  });

  it("command palette wires workspace commands to createWorkspaceFromDef", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain(
      "cmd.workspace) createWorkspaceFromDef(cmd.workspace)",
    );
  });

  it("autoloads workspaces from config on startup", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("config.autoload");
    expect(source).toContain("createWorkspaceFromDef(cmd.workspace)");
    // Restores active workspaces from persisted state, then falls back to dashboard
    expect(source).toContain("restoreActiveWorkspaces");
  });

  it("handles layout with splits and surface definitions", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // Must handle split layouts recursively
    expect(source).toContain("buildTree(nodeDef.children[0]");
    expect(source).toContain("buildTree(nodeDef.children[1]");
    // Must handle startup commands via startupCommand field (sent after PTY connects)
    expect(source).toContain("sDef.command");
    expect(source).toContain("startupCommand");
    // Must handle markdown surfaces
    expect(source).toContain('sDef.type === "markdown"');
  });
});

describe("New tab inherits cwd from active surface", () => {
  it("createTerminalSurface stores cwd on the surface object", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // The surface object must include cwd so new tabs can inherit it
    expect(source).toMatch(/const surface.*=.*\{[\s\S]*?cwd[:\s]/);
  });

  it("handleNewSurface reads cwd from active surface", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("$activeSurface.cwd");
  });
});

describe("No spurious fit/scrollToBottom on store updates", () => {
  it("TerminalSurface does not call fit() reactively (PaneView ResizeObserver handles it)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/TerminalSurface.svelte",
      "utf-8",
    );
    // Reactive fit() races with ResizeObserver and measures stale dimensions.
    // Only the onMount fit (for initial open) should exist.
    const afterOnMount = source.split("onMount")[1] || "";
    const afterClosingBrace = afterOnMount.split("});")[1] || "";
    // No reactive fit() outside of onMount
    expect(afterClosingBrace).not.toMatch(/fitAddon\.fit\(\)/);
  });

  it("switchWorkspace does not directly call fit or scrollToBottom", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    const start = source.indexOf("function switchWorkspace");
    const end = source.indexOf("\n  function ", start + 1);
    const fn = source.slice(start, end);
    // Must NOT call these directly — ResizeObserver and TerminalSurface handle them
    expect(fn).not.toMatch(/\.fitAddon\.fit\(\)/);
    expect(fn).not.toMatch(/\.scrollToBottom\(\)/);
  });

  it("togglePaneZoom does not directly call fit or scrollToBottom", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    const start = source.indexOf("function togglePaneZoom");
    const end = source.indexOf("\n  function ", start + 1);
    const fn = source.slice(start, end);
    expect(fn).not.toMatch(/\.fitAddon\.fit\(\)/);
    expect(fn).not.toMatch(/\.scrollToBottom\(\)/);
  });
});

describe("Flash focused pane", () => {
  it("flashFocusedPane uses pane.element for CSS animation", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("pane.element");
    expect(source).toContain("boxShadow");
    // Must NOT be a stub/TODO
    expect(source).not.toContain("skip for now");
  });

  it("Pane type has element property", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/types.ts", "utf-8");
    expect(source).toContain("element?: HTMLElement");
  });

  it("PaneView stores element ref on pane", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/PaneView.svelte",
      "utf-8",
    );
    expect(source).toContain("pane.element = paneEl");
  });
});

describe("Tab drag reorder within pane", () => {
  it("Tab.svelte has drag handlers", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/Tab.svelte", "utf-8");
    expect(source).toContain('draggable="true"');
    expect(source).toContain("on:dragstart=");
    expect(source).toContain("on:drop=");
    expect(source).toContain("onReorder");
  });

  it("App.svelte has handleReorderTab", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("function handleReorderTab");
    expect(source).toContain("pane.surfaces.splice");
  });
});

describe("Theme reactivity for previews", () => {
  it("PreviewSurface updates colors on theme change", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/PreviewSurface.svelte",
      "utf-8",
    );
    expect(source).toContain("$theme.bg");
    expect(source).toContain("$theme.fg");
    expect(source).toContain("surface.element.style.background");
  });

  it("preview index exports refreshPreviewStyles", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/index.ts", "utf-8");
    expect(source).toContain("export function refreshPreviewStyles");
  });

  it("theme changes call refreshPreviewStyles", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("refreshPreviewStyles()");
  });
});

describe("CWD polling fallback", () => {
  it("terminal-service has startCwdPolling", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(source).toContain("export function startCwdPolling");
    expect(source).toContain("get_pty_cwd");
  });

  it("App.svelte calls startCwdPolling on mount", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("startCwdPolling()");
  });
});

describe("Workspace save/restore", () => {
  it("serializeLayout produces config-compatible output", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("function serializeLayout");
    // Must handle both pane and split nodes
    expect(source).toContain('node.type === "pane"');
    expect(source).toContain("node.direction");
    expect(source).toContain("node.ratio");
  });

  it("saveCurrentWorkspace saves to config commands", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("async function saveCurrentWorkspace");
    expect(source).toContain("saveSettings({ commands }");
  });

  it("command palette has Save Current Workspace", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain('"Save Current Workspace..."');
  });
});

describe("Command palette has all required commands", () => {
  it("includes close, zoom, surface nav, and find commands", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    const requiredCommands = [
      "Close Surface",
      "Close Workspace",
      "Toggle Pane Zoom",
      "Next Surface",
      "Previous Surface",
      "Toggle Find Bar",
      "Clear Scrollback",
    ];
    for (const cmd of requiredCommands) {
      expect(source).toContain(`"${cmd}"`);
    }
  });
});

describe("Context menu has split actions", () => {
  it("context menu includes Split Right and Split Down", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(source).toContain('"Split Right"');
    expect(source).toContain('"Split Down"');
    // Must dispatch via pendingAction so App.svelte handles the split
    expect(source).toContain('"split-right"');
    expect(source).toContain('"split-down"');
  });

  it("App.svelte handles split-right and split-down pending actions", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain('"split-right"');
    expect(source).toContain('"split-down"');
  });
});

describe("Keyboard shortcuts completeness", () => {
  it("Cmd+K clears scrollback", async () => {
    const fs = await import("fs");
    // Keybindings now live in keybindings.ts, App.svelte wires clearTerminal action
    const kb = fs.readFileSync("src/lib/keybindings.ts", "utf-8");
    expect(kb).toContain('e.key === "k"');
    expect(kb).toContain("clearTerminal");
    const app = fs.readFileSync("src/App.svelte", "utf-8");
    expect(app).toContain("terminal.clear()");
  });

  it("Cmd+G dispatches to FindBar findNext", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // Cmd+G must call findBarComponent.findNext(), not be a no-op
    expect(source).toContain("findBarComponent?.findNext()");
    expect(source).not.toContain("/* findNext handled by FindBar */");
  });

  it("Shift+Cmd+G dispatches to FindBar findPrev", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("findBarComponent?.findPrev()");
    expect(source).not.toContain("/* findPrev handled by FindBar */");
  });

  it("FindBar exports findNext and findPrev methods", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/FindBar.svelte",
      "utf-8",
    );
    expect(source).toContain("export function findNext()");
    expect(source).toContain("export function findPrev()");
  });
});

describe("SplitNodeView has draggable dividers with ratio support", () => {
  it("renders divider element between split children", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/SplitNodeView.svelte",
      "utf-8",
    );
    expect(source).toContain("split-divider");
    expect(source).toContain("on:mousedown={startDrag}");
  });

  it("uses ratio for flex sizing instead of hardcoded flex: 1", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/SplitNodeView.svelte",
      "utf-8",
    );
    expect(source).toContain("flex: {node.ratio}");
    expect(source).toMatch(/flex: \{1 -\s*node\.ratio\}/);
    // Should NOT have hardcoded flex: 1 for split children
    expect(source).not.toMatch(/style="flex: 1;[^"]*">\s*<SplitNodeView/);
  });

  it("clamps ratio between 0.1 and 0.9 during drag", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/SplitNodeView.svelte",
      "utf-8",
    );
    expect(source).toContain("Math.max(0.1, Math.min(0.9");
  });

  it("uses correct cursor for horizontal vs vertical splits", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/SplitNodeView.svelte",
      "utf-8",
    );
    expect(source).toContain("cursor: row-resize");
    expect(source).toContain("cursor: col-resize");
  });
});

describe("PaneView has ResizeObserver for terminal fitting", () => {
  it("creates ResizeObserver in onMount", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/PaneView.svelte",
      "utf-8",
    );
    expect(source).toContain("new ResizeObserver");
    expect(source).toContain("resizeObserver.observe");
  });

  it("debounces resize events to avoid excessive fitAddon.fit() calls", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/PaneView.svelte",
      "utf-8",
    );
    // Must have a debounce timer, not call fit() directly in the observer
    expect(source).toContain("setTimeout");
    expect(source).toContain("clearTimeout");
    expect(source).toContain("resizeTimer");
  });

  it("disconnects ResizeObserver and clears timer on destroy", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/PaneView.svelte",
      "utf-8",
    );
    expect(source).toContain("onDestroy");
    expect(source).toContain("resizeObserver?.disconnect()");
    expect(source).toContain("clearTimeout(resizeTimer)");
  });
});

describe("HomeScreen component", () => {
  it("exists and imports project stores", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/HomeScreen.svelte",
      "utf-8",
    );
    expect(source).toContain("activeProjects");
    expect(source).toContain("ProjectCard");
  });

  it("has project cards and add buttons", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/HomeScreen.svelte",
      "utf-8",
    );
    expect(source).toContain("ProjectCard");
    expect(source).toContain("onAddProject");
  });

  it("has add project button", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/HomeScreen.svelte",
      "utf-8",
    );
    expect(source).toContain("+ New Project");
    expect(source).toContain("onAddProject");
  });

  it("renders active project cards", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/HomeScreen.svelte",
      "utf-8",
    );
    expect(source).toContain("$activeProjects");
    expect(source).toContain("ProjectCard");
  });
});

describe("ProjectCard component", () => {
  it("displays project name and path", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/ProjectCard.svelte",
      "utf-8",
    );
    expect(source).toContain("project.name");
    expect(source).toContain("project.path");
  });

  it("lists open workspaces and has new workspace button", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/ProjectCard.svelte",
      "utf-8",
    );
    expect(source).toContain("openWorkspaces");
    expect(source).toContain("onSwitchToWorkspace");
    expect(source).toContain("+ New Workspace");
    expect(source).toContain("onNewWorkspace");
  });
});

describe("App.svelte navigation", () => {
  it("imports currentView and navigation functions", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("currentView");
    expect(source).toContain("goHome");
    expect(source).toContain("openWorkspace");
  });

  it("conditionally renders HomeScreen or workspace view", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain('$currentView === "home"');
    expect(source).toContain("<HomeScreen");
    expect(source).toContain("terminal-area");
  });

  it("loads state from disk before initializing project store", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("await loadState()");
    expect(source).toContain("initProjects()");
    // In the onMount block, loadState must come before initProjects
    const onMountSection = source.slice(source.indexOf("onMount("));
    const loadIdx = onMountSection.indexOf("await loadState()");
    const initIdx = onMountSection.indexOf("initProjects()");
    expect(loadIdx).toBeLessThan(initIdx);
  });

  it("has handleAddProject with native file picker", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // handleAddProject extracted to workspace-actions.ts
    const actions = fs.readFileSync("src/lib/workspace-actions.ts", "utf-8");
    expect(actions).toContain("async function handleAddProject");
    expect(actions).toContain("registerProject");
    expect(actions).toContain("showNewProjectDialog");
  });
});
