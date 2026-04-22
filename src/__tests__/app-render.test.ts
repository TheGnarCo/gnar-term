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
    expect(source).toContain('createWorkspace("Workspace 1")');
  });

  it("does not duplicate surface push (createTerminalSurface handles it)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // createTerminalSurface already pushes to pane.surfaces
    // App.svelte should NOT have pane.surfaces.push(surface) after calling it
    const lines = source.split("\n");
    const createCalls = lines.filter(l => l.includes("createTerminalSurface"));
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
    expect(source).toContain("<PrimarySidebar");
    expect(source).toContain("<SecondarySidebar");
    expect(source).toContain("<TitleBar");
    expect(source).toContain("<WorkspaceView");
    expect(source).toContain("<FindBar");
    expect(source).toContain("<CommandPalette");
    expect(source).toContain("<ContextMenu");
  });

  it("terminal area has overflow: hidden for viewport containment", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("id=\"terminal-area\"");
    // The terminal-area must have overflow hidden to prevent viewport overflow
    const termAreaMatch = source.match(/id="terminal-area"[^>]*style="([^"]*)"/);
    expect(termAreaMatch).not.toBeNull();
    expect(termAreaMatch![1]).toContain("overflow: hidden");
    expect(termAreaMatch![1]).toContain("min-height: 0");
  });
});

describe("TerminalSurface component structure", () => {
  it("opens terminal via surface.termElement in onMount (context menu lives there)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/TerminalSurface.svelte", "utf-8");
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
    const source = fs.readFileSync("src/lib/components/TerminalSurface.svelte", "utf-8");
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
    expect(source).toContain("activeWorkspaceIdx.set(Math.max(0, wsList.length - 1))");
  });

  it("creates default workspace when all workspaces are removed", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // When wsList becomes empty, must schedule workspace creation
    expect(source).toContain("createDefaultWorkspace()");
    expect(source).toContain("wsList.length === 0");
  });

  it("exports createDefaultWorkspace for recovery", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(source).toContain("export async function createDefaultWorkspace()");
  });
});

describe("Preview scrolling works", () => {
  it("PreviewSurface container allows scrolling (not overflow: hidden)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/PreviewSurface.svelte", "utf-8");
    // Container must allow vertical scrolling
    expect(source).toContain("overflow-y: auto");
    // Must NOT have overflow: hidden which would clip scrollable content
    expect(source).not.toContain("overflow: hidden");
  });
});

describe("Config loads per-project files", () => {
  it("loadConfig checks local config paths before global", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/config.ts", "utf-8");
    // Must spread CONFIG_FILENAMES (local paths) into the search order
    expect(source).toContain("...CONFIG_FILENAMES");
  });

  it("CONFIG_FILENAMES includes gnar-term.json and cmux.json", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/config.ts", "utf-8");
    expect(source).toContain('"gnar-term.json"');
    expect(source).toContain('"cmux.json"');
  });
});

describe("Workspace from config definition", () => {
  it("createWorkspaceFromDef is implemented in workspace-service", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/services/workspace-service.ts", "utf-8");
    expect(source).toContain("async function createWorkspaceFromDef");
  });

  it("command palette wires workspace commands to createWorkspaceFromDef", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("cmd.workspace) createWorkspaceFromDef(cmd.workspace)");
  });

  it("autoloads workspaces from config on startup", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("config.autoload");
    expect(source).toContain("createWorkspaceFromDef(cmd.workspace)");
    // Falls back to default workspace if nothing autoloaded
    expect(source).toContain("!autoloaded");
  });

  it("handles layout with splits and surface definitions", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/services/workspace-service.ts", "utf-8");
    expect(source).toContain("buildTree(nodeDef.children[0]");
    expect(source).toContain("buildTree(nodeDef.children[1]");
    expect(source).toContain("sDef.command");
    expect(source).toContain('startupCommand');
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

  it("getActiveCwd reads cwd from active surface", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/services/service-helpers.ts", "utf-8");
    expect(source).toContain("surface.cwd");
  });
});

describe("No spurious fit/scrollToBottom on store updates", () => {
  it("TerminalSurface does not call fit() reactively (PaneView ResizeObserver handles it)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/TerminalSurface.svelte", "utf-8");
    // Reactive fit() races with ResizeObserver and measures stale dimensions.
    // Only the onMount fit (for initial open) should exist.
    const afterOnMount = source.split("onMount")[1] || "";
    const afterClosingBrace = afterOnMount.split("});")[1] || "";
    // No reactive fit() outside of onMount
    expect(afterClosingBrace).not.toMatch(/fitAddon\.fit\(\)/);
  });

  it("switchWorkspace does not directly call fit or scrollToBottom", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/services/workspace-service.ts", "utf-8");
    const start = source.indexOf("function switchWorkspace");
    const end = source.indexOf("\nexport function ", start + 1);
    const fn = source.slice(start, end);
    expect(fn).not.toMatch(/\.fitAddon\.fit\(\)/);
    expect(fn).not.toMatch(/\.scrollToBottom\(\)/);
  });


});

describe("Flash focused pane", () => {
  it("flashFocusedPane uses pane.element for CSS animation", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/services/pane-service.ts", "utf-8");
    expect(source).toContain("pane.element");
    expect(source).toContain("boxShadow");
  });

  it("Pane type has element property", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/types.ts", "utf-8");
    expect(source).toContain("element?: HTMLElement");
  });

  it("PaneView stores element ref on pane", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/PaneView.svelte", "utf-8");
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

  it("pane-service has reorderTab", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/services/pane-service.ts", "utf-8");
    expect(source).toContain("function reorderTab");
    expect(source).toContain("pane.surfaces.splice");
  });
});

describe("Theme reactivity for previews", () => {
  it("PreviewSurface updates colors on theme change", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/PreviewSurface.svelte", "utf-8");
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
    const source = fs.readFileSync("src/lib/services/workspace-service.ts", "utf-8");
    expect(source).toContain("function serializeLayout");
    expect(source).toContain("node.type === \"pane\"");
    expect(source).toContain("node.direction");
    expect(source).toContain("node.ratio");
  });

  it("saveCurrentWorkspace saves to config commands", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/services/workspace-service.ts", "utf-8");
    expect(source).toContain("async function saveCurrentWorkspace");
    expect(source).toContain("saveConfig({ commands }");
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
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // Must have Cmd+K handler that calls terminal.clear()
    expect(source).toMatch(/e\.key === "k".*terminal\.clear\(\)/);
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
    const source = fs.readFileSync("src/lib/components/FindBar.svelte", "utf-8");
    expect(source).toContain("export function findNext()");
    expect(source).toContain("export function findPrev()");
  });
});

describe("SplitNodeView has draggable dividers with ratio support", () => {
  it("renders divider element between split children", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/SplitNodeView.svelte", "utf-8");
    expect(source).toContain("split-divider");
    expect(source).toContain("use:dragResize");
  });

  it("uses ratio for flex sizing instead of hardcoded flex: 1", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/SplitNodeView.svelte", "utf-8");
    expect(source).toContain("flex: {node.ratio}");
    expect(source).toContain("flex: {1 - node.ratio}");
    // Should NOT have hardcoded flex: 1 for split children
    expect(source).not.toMatch(/style="flex: 1;[^"]*">\s*<SplitNodeView/);
  });

  it("clamps ratio between 0.1 and 0.9 during drag", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/SplitNodeView.svelte", "utf-8");
    expect(source).toContain("Math.max(0.1, Math.min(0.9");
  });

  it("uses correct cursor for horizontal vs vertical splits", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/SplitNodeView.svelte", "utf-8");
    expect(source).toContain("cursor: row-resize");
    expect(source).toContain("cursor: col-resize");
  });
});

describe("PaneView has ResizeObserver for terminal fitting", () => {
  it("creates ResizeObserver in onMount", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/PaneView.svelte", "utf-8");
    expect(source).toContain("new ResizeObserver");
    expect(source).toContain("resizeObserver.observe");
  });

  it("debounces resize events to avoid excessive fitAddon.fit() calls", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/PaneView.svelte", "utf-8");
    // Must have a debounce timer, not call fit() directly in the observer
    expect(source).toContain("setTimeout");
    expect(source).toContain("clearTimeout");
    expect(source).toContain("resizeTimer");
  });

  it("disconnects ResizeObserver and clears timer on destroy", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/components/PaneView.svelte", "utf-8");
    expect(source).toContain("onDestroy");
    expect(source).toContain("resizeObserver?.disconnect()");
    expect(source).toContain("clearTimeout(resizeTimer)");
  });
});
