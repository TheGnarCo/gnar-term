---
title: Getting Started
parent: Extensions
nav_order: 1
---

# Your First GnarTerm Extension

Build a working extension from scratch in under 10 minutes. By the end, you'll have a sidebar tab that lists the active terminal's recent git commits.

> **Where extensions live:** Extensions are standalone directories. They can live anywhere on your filesystem — inside the GnarTerm repo, in a separate project, or in their own git repository. The only requirement is a manifest file and a bundled JavaScript entry point.

## Prerequisites

- GnarTerm installed and running
- Node.js 18+ (or [Bun](https://bun.sh))
- Basic familiarity with TypeScript and Svelte

## What you'll build

A "Recent Commits" extension that:

1. Adds a tab to the secondary (right) sidebar
2. Fetches git log data from the active workspace
3. Displays commits with author and date
4. Refreshes when the user switches workspaces

This touches the most common extension patterns: sidebar registration, Tauri command invocation, event subscription, and theme integration.

## Step 1: Create the project

```bash
mkdir gnarterm-recent-commits && cd gnarterm-recent-commits
bun init -y
bun add -d svelte typescript vite @sveltejs/vite-plugin-svelte
```

## Step 2: Get the type definitions

The extension API types are available as a single self-contained file:

```bash
curl -O https://raw.githubusercontent.com/TheGnarCo/gnar-term/main/src/extensions/api.ts
```

This file depends only on `svelte/store` and provides `ExtensionAPI`, `ExtensionManifest`, `EXTENSION_API_KEY`, and all the types your extension needs. Keep it in your project root or `src/` folder.

## Step 3: Write the manifest

Create `extension.json` in your project root:

```json
{
  "id": "recent-commits",
  "name": "Recent Commits",
  "version": "0.1.0",
  "description": "Shows recent git commits in a sidebar tab",
  "entry": "./dist/index.js",
  "contributes": {
    "secondarySidebarTabs": [
      { "id": "commits", "label": "Commits", "icon": "git-commit" }
    ],
    "commands": [{ "id": "refresh", "title": "Recent Commits: Refresh" }],
    "events": ["workspace:activated"]
  }
}
```

Key points:

- **`id`** must be unique, lowercase, and hyphen-separated
- **`entry`** points to your bundled output (not your source)
- **`contributes`** declares everything upfront — the sidebar tab, commands, and events your extension uses
- **`events`** is deny-by-default. If you don't declare `workspace:activated` here, `api.on("workspace:activated", ...)` will throw at runtime

## Step 4: Write the entry point

Create `src/index.ts`:

```typescript
import type { ExtensionAPI } from "../api";
import CommitList from "./CommitList.svelte";

export default function register(api: ExtensionAPI): void {
  api.onActivate(() => {
    // Register the sidebar tab component
    api.registerSecondarySidebarTab("commits", CommitList);

    // Register the refresh command
    api.registerCommand("refresh", () => {
      api.emit("extension:recent-commits:refresh", {});
    });

    // Refresh when workspace changes
    api.on("workspace:activated", () => {
      api.emit("extension:recent-commits:refresh", {});
    });
  });
}
```

Everything happens inside `onActivate`. This is important — registrations made outside `onActivate` (e.g., at the top level of `register()`) won't work because the extension isn't fully initialized yet.

## Step 5: Write the component

Create `src/CommitList.svelte`:

```svelte
<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  interface Commit {
    short_hash: string;
    subject: string;
    author_name: string;
    date: string;
  }

  let commits: Commit[] = [];
  let loading = false;
  let error = "";

  async function loadCommits() {
    loading = true;
    error = "";
    try {
      const cwd = await api.getActiveCwd();
      if (!cwd) {
        commits = [];
        return;
      }
      commits = await api.invoke<Commit[]>("git_log", {
        repo_path: cwd,
        count: 20,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      commits = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadCommits();
  });
</script>

<div class="commit-list" style="color: {$theme.fg}; padding: 8px;">
  {#if loading}
    <div style="color: {$theme.fgMuted};">Loading...</div>
  {:else if error}
    <div style="color: {$theme.danger};">{error}</div>
  {:else if commits.length === 0}
    <div style="color: {$theme.fgMuted};">No commits found</div>
  {:else}
    {#each commits as commit}
      <div
        class="commit"
        style="
          padding: 4px 0;
          border-bottom: 1px solid {$theme.border};
        "
      >
        <div style="font-family: monospace; color: {$theme.accent};">
          {commit.short_hash}
        </div>
        <div>{commit.subject}</div>
        <div style="font-size: 11px; color: {$theme.fgMuted};">
          {commit.author_name} &middot; {commit.date}
        </div>
      </div>
    {/each}
  {/if}
</div>
```

Notice:

- **`getContext`** retrieves the API — never import core modules directly
- **`$theme`** provides all colors — never hardcode them
- **`api.invoke`** calls Rust commands — never import `@tauri-apps/api`

## Step 6: Configure the build

Create `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "dist",
    rollupOptions: {
      external: ["svelte", "svelte/store", "svelte/internal"],
    },
  },
});
```

Bundling rules:

- **ES module format** — extensions use `export default function register`
- **Externalize Svelte** — the host provides Svelte; don't bundle it
- **Single file output** — the entry point must resolve to one `.js` file

## Step 7: Build and install

```bash
bun run vite build
```

Then in GnarTerm:

1. Open Settings (gear icon or `Cmd+,`)
2. Go to **Extensions**
3. Click **Install from path**
4. Select your `gnarterm-recent-commits` directory

Your "Commits" tab should appear in the right sidebar immediately.

## Step 8: Iterate

During development, rebuild and reload:

```bash
# Terminal 1: watch for changes
bun run vite build --watch

# In GnarTerm: disable and re-enable the extension in Settings > Extensions
# to pick up the new build
```

Use the browser DevTools (`right-click > Inspect` in GnarTerm) to see console output and debug your components.

## What just happened

Here's the full flow of what GnarTerm did when you installed:

1. **Read** your `extension.json` and validated all fields
2. **Loaded** `dist/index.js` via dynamic `import()`
3. **Called** your `register(api)` function with a sandboxed API object
4. **Called** your `onActivate()` callback
5. **Rendered** your `CommitList.svelte` in the sidebar, wrapped in an `ExtensionWrapper` that injects the API via Svelte context
6. **Persisted** the extension config to `~/.config/gnar-term/settings.json` so it loads on next startup

If your `onActivate` had thrown an error, GnarTerm would have automatically rolled back all registrations, cleaned up event subscriptions, and marked the extension as disabled.

## Using shared components

Extensions must never import from `src/lib/` directly. Instead, use `api.getComponents()` to access shared UI components:

```svelte
<script lang="ts">
  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const { SplitButton, ColorPicker, WorkspaceListView } = api.getComponents();
</script>

<!-- Render shared components with svelte:component -->
<svelte:component
  this={SplitButton}
  label="+ New"
  onMainClick={handleClick}
  dropdownItems={items}
  {theme}
/>
```

See the [Component Catalog](../EXTENSIONS.md#component-catalog) in EXTENSIONS.md for the full list with props.

## Next steps

You now have a working extension. Here's where to go from here:

| Want to...                           | Read                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| See all available API methods        | [EXTENSIONS.md](../EXTENSIONS.md) — full API reference             |
| Find recipes for common patterns     | [Extension Cookbook](extension-cookbook.md) — step-by-step recipes |
| Set up unit tests                    | [Development Guide](extension-development.md#testing)              |
| Understand the registry architecture | [Registry System](registry-system.md)                              |
| Learn the design decisions           | [ADR-001](adr/001-extension-architecture.md)                       |
| Look at real extension source code   | `src/extensions/` in the GnarTerm repo — all 9 included extensions |

## Extension doc map

```
EXTENSIONS.md                    API reference (manifest, methods, events, commands)
docs/
  extension-getting-started.md   This guide — your first extension
  extension-development.md       Project setup, building, testing, debugging, distribution
  extension-cookbook.md           Recipes for common patterns
  registry-system.md             How registries work (architecture)
  sidebar-architecture.md        Sidebar layout rules
  glossary.md                    Term definitions
  adr/001-extension-architecture.md  Design decisions and trade-offs
```
