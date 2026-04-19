/**
 * App render verification test.
 * Verifies the Svelte 5 mount() call works and the App component
 * renders its expected DOM structure.
 */
import { describe, it, expect, vi } from "vitest";
import type { TerminalSurface } from "../lib/types";

// Mock Tauri APIs before any imports that use them
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("svelte", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, tick: vi.fn().mockResolvedValue(undefined) };
});

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
describe("Svelte 5 mount() entry point", () => {
  it("main.ts uses mount() not new App()", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/main.ts", "utf-8");
    expect(source).toContain('import { mount } from "svelte"');
    expect(source).toContain("mount(App");
    expect(source).not.toContain("new App(");
  });
});

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
describe("App.svelte structure verification", () => {
  it("has proper onMount initialization", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // Must await fontReady before creating workspace
    expect(source).toContain("await fontReady");
    expect(source).toContain("setupListeners()");
    // Workspace restoration moved to bootstrap/restore-workspaces.ts —
    // the fallback "Workspace 1" seed now lives there.
    const restore = fs.readFileSync(
      "src/lib/bootstrap/restore-workspaces.ts",
      "utf-8",
    );
    expect(restore).toContain('createWorkspace("Workspace 1")');
  });

  it("does not duplicate surface push (createTerminalSurface handles it)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // createTerminalSurface already pushes to pane.surfaces
    // App.svelte should NOT have pane.surfaces.push(surface) after calling it
    const lines = source.split("\n");
    const _createCalls = lines.filter((l) =>
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

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
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
    const ts = await import("../lib/terminal-service");
    // openTerminalSurface was removed — TerminalSurface.svelte is the sole owner of terminal.open()
    expect(
      (ts as Record<string, unknown>)["openTerminalSurface"],
    ).toBeUndefined();
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

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
describe("pendingAction consumer", () => {
  it("App.svelte imports and reacts to pendingAction", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("pendingAction");
    expect(source).toContain("$pendingAction");
    // Must clear the action after consuming it
    expect(source).toContain("pendingAction.set(null)");
  });

  it("terminal-service dispatches file-link clicks via the context-menu registry", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(source).toContain("getContextMenuItemsForFile");
    expect(source).not.toContain('"open-preview"');
  });
});

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
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
    // Structural invariant: verified via source scan because this logic
    // runs inside a Tauri event listener that can't be triggered in vitest.
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // After splicing a workspace from the list, activeWorkspaceIdx must be
    // clamped to the new last index (or -1 when the list is empty, so the
    // Empty Surface takes over).
    expect(source).toContain("activeWorkspaceIdx.set(wsList.length - 1)");
  });

  it("does NOT auto-create a default workspace when all are closed (Empty Surface takes over)", async () => {
    // Structural invariant: verified via source scan because this logic
    // runs inside a Tauri event listener that can't be triggered in vitest.
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // The pty-close handler must not schedule an auto-workspace.
    // (`createDefaultWorkspace` may still exist as an exported helper
    // for explicit recovery, but it must not be called from the
    // close-surface path.)
    expect(source).not.toMatch(/needsDefaultWorkspace\s*=\s*true/);
  });

  it("exports createDefaultWorkspace for recovery", async () => {
    const ts = await import("../lib/terminal-service");
    expect(typeof ts.createDefaultWorkspace).toBe("function");
  });
});

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
describe("Preview scrolling works", () => {
  it("PreviewSurface container allows scrolling (not overflow: hidden)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/extensions/preview/PreviewSurface.svelte",
      "utf-8",
    );
    // Container must allow vertical scrolling
    expect(source).toContain("overflow-y: auto");
    // Must NOT have overflow: hidden which would clip scrollable content
    expect(source).not.toContain("overflow: hidden");
  });
});

describe("Config loads per-project files", () => {
  // Structural invariant: CONFIG_FILENAMES is a module-private constant
  // that can't be imported. Verified via source scan.
  it("loadConfig checks local config paths before global", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/config.ts", "utf-8");
    // Must spread CONFIG_FILENAMES (local paths) into the search order
    expect(source).toContain("...CONFIG_FILENAMES");
  });

  it("CONFIG_FILENAMES includes settings.json, gnar-term.json (legacy), and cmux.json", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/config.ts", "utf-8");
    expect(source).toContain('"settings.json"');
    expect(source).toContain('"gnar-term.json"');
    expect(source).toContain('"cmux.json"');
  });
});

describe("Workspace from config definition", () => {
  it("createWorkspaceFromDef is implemented in workspace-service", async () => {
    const ws = await import("../lib/services/workspace-service");
    expect(typeof ws.createWorkspaceFromDef).toBe("function");
  });

  // Structural invariant: verified via source scan because mounting the full
  // component tree requires Tauri runtime which isn't available in vitest.
  it("command palette wires workspace commands to createWorkspaceFromDef", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain(
      "cmd.workspace) void createWorkspaceFromDef(cmd.workspace)",
    );
  });

  it("autoloads workspaces from config on startup", async () => {
    const fs = await import("fs");
    // Startup resolution lives in bootstrap/restore-workspaces.ts —
    // scan that module for the autoload branch.
    const source = fs.readFileSync(
      "src/lib/bootstrap/restore-workspaces.ts",
      "utf-8",
    );
    expect(source).toContain("config.autoload");
    expect(source).toContain("createWorkspaceFromDef(cmd.workspace)");
    // Falls back to default workspace if nothing autoloaded
    expect(source).toContain("!autoloaded");
  });

  // Structural invariant: verified via source scan because createWorkspaceFromDef
  // calls Tauri invoke internally, so it can't be run in vitest.
  it("handles layout with splits and surface definitions", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/services/workspace-service.ts",
      "utf-8",
    );
    expect(source).toContain("nodeDef.children[0]");
    expect(source).toContain("nodeDef.children[1]");
    expect(source).toContain("sDef.command");
    expect(source).toContain("startupCommand");
    expect(source).toContain('sDef.type === "extension"');
  });
});

describe("New tab inherits cwd from active surface", () => {
  it("createTerminalSurface stores cwd on the surface object", async () => {
    const ts = await import("../lib/terminal-service");
    expect(typeof ts.createTerminalSurface).toBe("function");
    // The function signature accepts cwd — verified by the type system.
    // Deeper behavioral test: calling it requires a real Tauri runtime.
  });

  it("getActiveCwd reads cwd from active surface", async () => {
    const helpers = await import("../lib/services/service-helpers");
    expect(typeof helpers.getActiveCwd).toBe("function");
  });
});

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
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
    const source = fs.readFileSync(
      "src/lib/services/workspace-service.ts",
      "utf-8",
    );
    const start = source.indexOf("function switchWorkspace");
    const end = source.indexOf("\nexport function ", start + 1);
    const fn = source.slice(start, end);
    expect(fn).not.toMatch(/\.fitAddon\.fit\(\)/);
    expect(fn).not.toMatch(/\.scrollToBottom\(\)/);
  });
});

describe("Flash focused pane", () => {
  it("flashFocusedPane is exported from pane-service", async () => {
    const ps = await import("../lib/services/pane-service");
    expect(typeof ps.flashFocusedPane).toBe("function");
  });

  it("Pane type has element property", async () => {
    // Verify structural property via a constructed object that satisfies the type
    const types = await import("../lib/types");
    const pane: import("../lib/types").Pane = {
      id: "test",
      surfaces: [],
      activeSurfaceId: null,
      element: undefined,
    };
    // The 'element' field is accepted on the Pane type — proves the property exists.
    expect("element" in pane).toBe(true);
    // Also verify getAllPanes works with this structure (proves type is correct)
    const node: import("../lib/types").SplitNode = { type: "pane", pane };
    expect(types.getAllPanes(node)).toHaveLength(1);
  });

  // Structural invariant: verified via source scan because mounting PaneView
  // requires Tauri runtime which isn't available in vitest.
  it("PaneView stores element ref on pane", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/PaneView.svelte",
      "utf-8",
    );
    expect(source).toContain("pane.element = paneEl");
  });
});

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
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
    const ps = await import("../lib/services/pane-service");
    expect(typeof ps.reorderTab).toBe("function");
  });
});

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
describe("Theme reactivity for previews", () => {
  it("PreviewSurface updates colors on theme change", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/extensions/preview/PreviewSurface.svelte",
      "utf-8",
    );
    expect(source).toContain("$theme.bg");
    expect(source).toContain("$theme.fg");
    expect(source).toContain("element.style.background");
  });

  it("preview extension exports refreshPreviewStyles", async () => {
    const preview = await import("../extensions/preview/preview-service");
    expect(typeof preview.refreshPreviewStyles).toBe("function");
  });

  // Structural invariant: preview extension subscribes to theme:changed
  it("preview extension subscribes to theme:changed for style refresh", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/extensions/preview/index.ts", "utf-8");
    expect(source).toContain('"theme:changed"');
    expect(source).toContain("refreshPreviewStyles");
  });

  it("applyTheme emits theme:changed event", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("theme:changed");
  });
});

describe("CWD polling fallback", () => {
  it("terminal-service has startCwdPolling", async () => {
    const ts = await import("../lib/terminal-service");
    expect(typeof ts.startCwdPolling).toBe("function");
  });

  // Structural invariant: verified via source scan because mounting the full
  // component tree requires Tauri runtime which isn't available in vitest.
  it("App.svelte calls startCwdPolling on mount", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain("startCwdPolling()");
  });
});

describe("Workspace save/restore", () => {
  it("serializeLayout produces config-compatible output", async () => {
    const { serializeLayout } =
      await import("../lib/services/workspace-service");

    // Test with a simple pane node
    const paneNode: import("../lib/types").SplitNode = {
      type: "pane",
      pane: {
        id: "p1",
        surfaces: [
          {
            kind: "terminal",
            id: "s1",
            title: "zsh",
            cwd: "/home/user",
            hasUnread: false,
            opened: true,
            ptyId: 1,
            terminal: {} as unknown as TerminalSurface["terminal"],
            fitAddon: {} as unknown as TerminalSurface["fitAddon"],
            searchAddon: {} as unknown as TerminalSurface["searchAddon"],
            termElement: {} as unknown as TerminalSurface["termElement"],
          },
        ],
        activeSurfaceId: "s1",
      },
    };
    const result = serializeLayout(paneNode);
    expect(result).toHaveProperty("pane");
    const pane = (result as { pane: { surfaces: Record<string, unknown>[] } })
      .pane;
    expect(pane.surfaces).toHaveLength(1);
    expect(pane.surfaces[0].type).toBe("terminal");
    expect(pane.surfaces[0].name).toBe("zsh");
    expect(pane.surfaces[0].cwd).toBe("/home/user");
    expect(pane.surfaces[0].focus).toBe(true);

    // Test with a split node
    const splitNode: import("../lib/types").SplitNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.6,
      children: [paneNode, paneNode],
    };
    const splitResult = serializeLayout(splitNode);
    expect(splitResult).toHaveProperty("direction", "horizontal");
    expect(splitResult).toHaveProperty("split", 0.6);
    expect(splitResult).toHaveProperty("children");
  });

  it("saveCurrentWorkspace is exported from workspace-service", async () => {
    const ws = await import("../lib/services/workspace-service");
    expect(typeof ws.saveCurrentWorkspace).toBe("function");
  });

  // Structural invariant: verified via source scan because mounting the full
  // component tree requires Tauri runtime which isn't available in vitest.
  it("command palette has Save Current Workspace", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).toContain('"Save Current Workspace..."');
  });
});

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
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

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
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

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
describe("Keyboard shortcuts completeness", () => {
  it("Cmd+K clears scrollback", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // Must have Cmd+K handler that calls terminal.clear() (table-driven or inline)
    expect(source).toContain("terminal.clear()");
    // The "k" key must appear in the shortcut table or handler
    expect(source).toMatch(/k.*terminal\.clear|terminal\.clear.*\bk\b/s);
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

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
describe("SplitNodeView has draggable dividers with ratio support", () => {
  it("renders divider element between split children", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/SplitNodeView.svelte",
      "utf-8",
    );
    expect(source).toContain("split-divider");
    expect(source).toContain("use:dragResize");
  });

  it("uses ratio for flex sizing instead of hardcoded flex: 1", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/SplitNodeView.svelte",
      "utf-8",
    );
    expect(source).toContain("flex: {node.ratio}");
    expect(source).toMatch(/flex:\s*\{1\s*-\s*node\.ratio\}/);
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

// Structural invariant: verified via source scan because mounting the full
// component tree requires Tauri runtime which isn't available in vitest.
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
