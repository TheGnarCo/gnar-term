---
title: Cookbook
parent: Extensions
nav_order: 3
---

# Extension Cookbook

Step-by-step patterns for common extension tasks. Each recipe shows the minimal code needed. See [EXTENSIONS.md](../EXTENSIONS.md) for the full API reference and [Extension Development Guide](extension-development.md) for project setup and build workflow.

## Recipe: Add a Secondary Sidebar Tab

The most common extension pattern — contribute a panel to the right sidebar.

```typescript
// index.ts
import type { ExtensionManifest, ExtensionAPI } from "../api";
import MyPanel from "./MyPanel.svelte";

export const manifest: ExtensionManifest = {
  id: "my-ext",
  name: "My Extension",
  version: "0.1.0",
  description: "Adds a custom sidebar tab",
  entry: "./index.ts",
  included: true,
  contributes: {
    secondarySidebarTabs: [{ id: "my-tab", label: "My Tab", icon: "star" }],
  },
};

export function register(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerSecondarySidebarTab("my-tab", MyPanel);
  });
}
```

```svelte
<!-- MyPanel.svelte -->
<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
</script>

<div style="padding: 8px; color: {$theme.fg};">Hello from My Extension!</div>
```

## Recipe: Add a Primary Sidebar Section

Contribute a collapsible section to the left sidebar (below Workspaces).

```typescript
api.onActivate(() => {
  api.registerPrimarySidebarSection("my-section", MySectionContent);
});
```

The section's label comes from the manifest's `contributes.primarySidebarSections` entry. Options like `collapsible` and `showLabel` can be passed as a third argument.

## Recipe: Register a Command

Add an action to the command palette (`Cmd+P` / `Ctrl+P`).

```typescript
// Declare in manifest
contributes: {
  commands: [{ id: "do-something", title: "Do Something Cool" }],
}

// Register handler
api.onActivate(() => {
  api.registerCommand("do-something", async () => {
    const input = await api.showInputPrompt("What should I do?");
    if (input) console.log("Doing:", input);
  });
});
```

## Recipe: Register a Workspace Action Button

Add a button to the workspace header's "+ New" dropdown (default) or the sidebar top bar.

```typescript
api.onActivate(() => {
  // Appears in the "+ New" dropdown (zone: "workspace" is the default)
  api.registerWorkspaceAction("quick-terminal", {
    label: "Quick Terminal",
    icon: "terminal",
    handler: async (ctx) => {
      await api.createWorkspace("Quick", ctx.groupPath as string);
    },
    when: (ctx) => !!ctx.groupPath, // Only show in group sections
  });

  // Appears as a button in the sidebar top bar
  api.registerWorkspaceAction("new-group", {
    label: "New Group",
    icon: "folder-plus",
    zone: "sidebar",
    handler: async () => {
      /* ... */
    },
  });
});
```

## Recipe: Register an Overlay (Dialog/Modal)

Full-screen overlays render above the main content. Use for settings pages, dashboards, or multi-step dialogs.

```typescript
import MyOverlay from "./MyOverlay.svelte";

api.onActivate(() => {
  // Overlays render as long as they are registered.
  // Register to show, unregister to hide.
  api.registerOverlay("my-settings", MyOverlay);

  // To remove the overlay later:
  api.unregisterOverlay("my-settings");
});
```

## Recipe: Claim Workspaces

Hide workspaces from the main list and display them in your own sidebar section.

```typescript
api.onActivate(() => {
  // Listen for new workspaces and claim ones matching your criteria
  api.on("workspace:created", (event) => {
    if (shouldClaim(event)) {
      api.claimWorkspace(event.id);
    }
  });

  // Render claimed workspaces in your own section
  api.registerPrimarySidebarSection("my-workspaces", MyWorkspaceSection);
});
```

## Recipe: Prompt for Multi-Field Input

Use `showFormPrompt` for forms with multiple fields.

```typescript
const result = await api.showFormPrompt("Create Project", [
  { key: "name", label: "Project Name", placeholder: "My Project" },
  { key: "path", label: "Root Directory", defaultValue: "/home/user" },
  { key: "color", label: "Accent Color", defaultValue: "#4a9eff" },
]);

if (result) {
  // result is { name: string, path: string, color: string } or null if cancelled
  console.log("Creating project:", result.name);
}
```

Each field accepts `key`, `label`, and optional `placeholder` / `defaultValue`. All values are returned as strings.

## Recipe: Persist State Across Restarts

Each extension gets scoped key-value storage:

```typescript
api.onActivate(() => {
  // Read saved state (synchronous — loaded from disk on activate)
  const count = api.state.get<number>("visitCount") ?? 0;

  // Update state (debounced write to disk every 300ms)
  api.state.set("visitCount", count + 1);
});
```

State is stored at `~/.config/gnar-term/extensions/<extension-id>/state.json`.

## Recipe: React to Theme Changes

```typescript
// In your extension's index.ts
contributes: {
  events: ["theme:changed"];
}

api.onActivate(() => {
  api.on("theme:changed", () => {
    // Re-render custom elements, update inline styles, etc.
  });
});
```

In Svelte components, use the reactive `$theme` store instead:

```svelte
<script>
  const theme = api.theme;
</script>

<div
  style="background: {$theme.bg}; color: {$theme.fg}; border-color: {$theme.border};"
>
  Content adapts to theme automatically
</div>
```

## Recipe: Register a Custom Surface Type

Add a new type of tab content (beyond terminal and preview).

```typescript
import MyViewer from "./MyViewer.svelte";

// Declare in manifest
contributes: {
  surfaces: [{ id: "my-viewer", label: "My Viewer" }],
}

api.onActivate(() => {
  api.registerSurfaceType("my-viewer", MyViewer);

  // Open your surface type programmatically
  api.openSurface("my-viewer", "Tab Title", { filePath: "/some/path" });
});
```

The `MyViewer.svelte` component receives `surface` and `visible` props:

```svelte
<script lang="ts">
  import type { ExtensionSurface } from "../../lib/types";
  export let surface: ExtensionSurface;
  export let visible: boolean;
  // Access custom data via surface.props
</script>
```

## Recipe: Use Tauri Commands

Extensions call Rust backend commands through `api.invoke()`:

```typescript
// File system
const content = await api.invoke<string>("read_file", { path: "/some/file" });
const entries = await api.invoke<DirEntry[]>("list_dir", { path: "/some/dir" });

// Git info
const log = await api.invoke("git_log", { repo_path: cwd, count: 10 });
const status = await api.invoke("git_status", { repo_path: cwd });

// Git worktree
const worktrees = await api.invoke("list_worktrees", { repo_path: cwd });
await api.invoke("create_worktree", {
  repo_path: cwd,
  branch: "feat/x",
  worktree_path: "/wt",
});
```

Most commands are available to all extensions by default. Only PTY commands require `"permissions": ["pty"]` in the manifest. See [EXTENSIONS.md — Tauri Commands](../EXTENSIONS.md#tauri-commands) for the full allowlist.

## Recipe: Add a Context Menu Item

Right-click menu items for files or directories:

```typescript
// Manifest
contributes: {
  contextMenuItems: [
    { id: "analyze", label: "Analyze File", when: "*.{ts,js}" },
    { id: "open-here", label: "Open Terminal Here", when: "directory" },
  ],
}

// Handlers
api.registerContextMenuItem("analyze", (filePath) => {
  console.log("Analyzing:", filePath);
});

api.registerContextMenuItem("open-here", (dirPath) => {
  api.createWorkspace("Terminal", dirPath);
});
```

## Recipe: Handle Errors from Tauri Commands

Always wrap `api.invoke()` calls in try/catch. Tauri commands can fail for many reasons — missing files, permission errors, git not installed, etc.

```typescript
async function loadFiles(path: string): Promise<DirEntry[]> {
  try {
    return await api.invoke<DirEntry[]>("list_dir", { path });
  } catch (e) {
    console.error(`Failed to list directory: ${e}`);
    return [];
  }
}
```

For user-facing errors, show feedback in your component rather than silently swallowing:

```svelte
<script lang="ts">
  let error = "";

  async function refresh() {
    error = "";
    try {
      data = await api.invoke("git_status", { repo_path: cwd });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

{#if error}
  <div style="color: {$theme.danger}; padding: 8px;">{error}</div>
{/if}
```

## Recipe: Communicate Between Extensions with Custom Events

Extensions can emit and subscribe to custom events using the `extension:` prefix. Both the emitting and subscribing extension must declare the event in their manifest.

**Emitting extension** (manifest):

```json
{
  "contributes": {
    "events": ["extension:my-ext:dataReady"]
  }
}
```

```typescript
api.onActivate(() => {
  // Emit when data is available
  api.emit("extension:my-ext:dataReady", { items: 42 });
});
```

**Subscribing extension** (manifest):

```json
{
  "contributes": {
    "events": ["extension:my-ext:dataReady"]
  }
}
```

```typescript
api.onActivate(() => {
  api.on("extension:my-ext:dataReady", (event) => {
    console.log(`Received ${event.items} items`);
  });
});
```

## Recipe: Async Initialization on Activate

Load data asynchronously when your extension activates. `onActivate` can be `async`:

```typescript
api.onActivate(async () => {
  // Register UI first (synchronous) so the tab appears immediately
  api.registerSecondarySidebarTab("my-tab", MyPanel);

  // Then load data in the background
  const saved = api.state.get<string[]>("recentPaths") ?? [];
  try {
    const home = await api.invoke<string>("get_home", {});
    const isRepo = await api.invoke<boolean>("is_git_repo", { path: home });
    api.state.set("homeIsRepo", isRepo);
  } catch {
    // Non-fatal — extension still works without this data
  }
});
```

Register UI elements before doing async work so users see your extension appear instantly, even if data loading takes a moment.

## Recipe: Clean Up Custom Resources

Core automatically cleans up all registry entries, event subscriptions, and file watchers on deactivation. Use `onDeactivate` only for custom resources like timers, WebSocket connections, or manual DOM modifications:

```typescript
api.onActivate(() => {
  const intervalId = setInterval(() => {
    refreshData();
  }, 30_000);

  api.onDeactivate(() => {
    clearInterval(intervalId);
  });
});
```

`onDeactivate` must be synchronous and is optional. If all your resources are registered through the API (commands, tabs, event handlers), you don't need it.

## Recipe: Use Read-Only Stores in Components

The API provides reactive Svelte stores for observing app state. Use the `$` prefix in components for auto-subscription:

```svelte
<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const workspaces = api.workspaces;
  const activeWs = api.activeWorkspace;
  const theme = api.theme;

  // Reactive — re-runs when active workspace changes
  $: wsName = $activeWs?.name ?? "None";
</script>

<div style="color: {$theme.fg}; padding: 8px;">
  <div>Active: {wsName}</div>
  <div>{$workspaces.length} workspace{$workspaces.length === 1 ? "" : "s"}</div>

  <ul>
    {#each $workspaces as ws}
      <li
        style="color: {ws.id === $activeWs?.id ? $theme.accent : $theme.fgDim};"
      >
        {ws.name}
      </li>
    {/each}
  </ul>
</div>
```

Available stores: `api.workspaces`, `api.activeWorkspace`, `api.activePane`, `api.activeSurface`, `api.theme`, `api.settings`.

## Accessing the API in Svelte Components

All extension Svelte components access the API through Svelte context — never through direct imports of core modules:

```svelte
<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
</script>
```

This pattern is set up by `ExtensionWrapper.svelte` which wraps all extension components. The API object is the same one passed to your `register()` function.

## Recipe: Use Shared Components

Extensions must not import from `src/lib/` — use the component catalog instead.

```svelte
<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const { SplitButton, ColorPicker, WorkspaceListView } = api.getComponents();

  let selectedColor = "#4a9eff";
  const dropdownItems = [
    { id: "option-a", label: "Option A", handler: () => console.log("A") },
    { id: "option-b", label: "Option B", handler: () => console.log("B") },
  ];
</script>

<!-- Split button with dropdown -->
<svelte:component
  this={SplitButton}
  label="+ New"
  onMainClick={() => console.log("main")}
  {dropdownItems}
  {theme}
/>

<!-- Color picker with bindable value -->
<svelte:component
  this={ColorPicker}
  bind:value={selectedColor}
  colors={["#4a9eff", "#ff6b6b", "#51cf66", "#ffd43b"]}
  {theme}
/>

<!-- Filtered workspace list -->
<svelte:component
  this={WorkspaceListView}
  filterIds={new Set(["ws-1", "ws-2"])}
  accentColor="#4a9eff"
/>
```

All shared components use `<svelte:component this={...}>` because they are
runtime references from the API, not static imports.

## Recipe: Mark a Surface as Unread

Signal that a surface needs attention (e.g., an agent is waiting for input). The surface tab shows a visual indicator until the user focuses it.

```typescript
// Declare in manifest
contributes: {
  events: ["extension:my-ext:needsAttention"],
}

api.onActivate(() => {
  api.on("extension:my-ext:needsAttention", (event) => {
    // Mark the surface — the tab shows an unread dot
    api.markSurfaceUnread(event.surfaceId);

    // Optionally navigate to it (works across workspaces)
    api.focusSurface(event.surfaceId);
  });
});
```

`markSurfaceUnread()` is idempotent — calling it multiple times has no additional effect. The unread indicator clears automatically when the surface is focused.

## Recipe: Badge a Sidebar Tab

Show a colored dot or activity indicator on a secondary sidebar tab to draw attention.

```typescript
api.onActivate(() => {
  // Show a badge on the "agents" tab
  api.badgeSidebarTab("agents", true);

  // Optionally switch to the tab
  api.activateSidebarTab("agents");
});
```

Clear the badge when the user has seen the content:

```typescript
api.on("sidebar:toggled", (event) => {
  if (event.tab === "agents") {
    api.badgeSidebarTab("agents", false);
  }
});
```

## Recipe: Show a Workspace Indicator

Display a status dot on a workspace item in the primary sidebar — useful for at-a-glance status like "agent running" or "needs attention."

The `setWorkspaceIndicator` API takes a workspace ID and a status string (or `null` to clear):

```typescript
setWorkspaceIndicator(workspaceId: string, status: string | null): void
```

```typescript
api.onActivate(() => {
  // Show a "running" indicator on the workspace
  api.setWorkspaceIndicator(workspaceId, "running");

  // Switch to "waiting" when the agent needs input
  api.setWorkspaceIndicator(workspaceId, "waiting");

  // Mark as idle when output stops
  api.setWorkspaceIndicator(workspaceId, "idle");

  // Clear the indicator when done
  api.setWorkspaceIndicator(workspaceId, null);
});
```

The status string maps to a visual indicator (colored dot) on the workspace sidebar item. The built-in Agentic Orchestrator extension uses `"running"`, `"waiting"`, and `"idle"` as status values — extensions can use any string, but these three have built-in styling. Pass `null` to remove the indicator entirely.

Workspace indicators persist until explicitly cleared or the workspace is closed. Only one indicator per workspace is shown at a time.

## Extension Documentation

- [Getting Started](extension-getting-started.md) — Build your first extension from scratch
- [EXTENSIONS.md](../EXTENSIONS.md) — Full API reference
- [Development Guide](extension-development.md) — Project setup, build, test, debug
- [Registry System](registry-system.md) — How registries work
- [Glossary](glossary.md) — Term definitions
