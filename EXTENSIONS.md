# GnarTerm Extension API

GnarTerm ships with an extension system that lets you add sidebar tabs, pane surface types, commands, context menu items, and settings without modifying core. Extensions are directories with a JSON manifest and a JavaScript entry point.

## Quick Start

An extension is a directory containing two files:

```
my-extension/
  extension.json      # manifest — declares what the extension provides
  dist/index.js       # entry point — registers behavior at runtime
```

### extension.json

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "0.1.0",
  "description": "A short description of what this does",
  "entry": "./dist/index.js",
  "contributes": {
    "commands": [{ "id": "greet", "title": "Say Hello" }]
  }
}
```

### dist/index.js

```typescript
export default function register(api) {
  api.onActivate(() => {
    api.registerCommand("greet", () => {
      console.log("Hello from my extension!");
    });
  });
}
```

### Install

Install from a local directory via the **Settings overlay** (Settings > Extensions > Install from path).

The extension is validated, loaded, activated, and persisted to `~/.config/gnar-term/settings.json` so it loads on next startup.

---

## Manifest Reference

The `extension.json` manifest declares metadata and contributions.

### Required Fields

| Field     | Type     | Description                                                                                                                 |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`      | `string` | Unique identifier. Lowercase alphanumeric with hyphens (e.g. `my-extension`). No leading, trailing, or consecutive hyphens. |
| `name`    | `string` | Display name shown in the Extensions page.                                                                                  |
| `version` | `string` | Semver version string.                                                                                                      |
| `entry`   | `string` | Path to the JS entry point, relative to the manifest directory.                                                             |

### Optional Fields

| Field         | Type      | Description                                                             |
| ------------- | --------- | ----------------------------------------------------------------------- |
| `description` | `string`  | One-line description.                                                   |
| `included`    | `boolean` | `true` for extensions shipped with core. External extensions omit this. |
| `contributes` | `object`  | Declares what the extension provides. See below.                        |

### Contributions

All contributions are declared upfront in the manifest. Core reads them before loading any code. At runtime, the extension calls `api.register*()` methods to provide the actual components and handlers.

```json
{
  "contributes": {
    "secondarySidebarTabs": [
      {
        "id": "issues",
        "label": "Issues",
        "icon": "github",
        "actions": [{ "id": "refresh", "icon": "refresh", "title": "Refresh" }]
      }
    ],
    "primarySidebarSections": [{ "id": "status", "label": "Status" }],
    "commands": [{ "id": "refresh-issues", "title": "Refresh Issues" }],
    "surfaces": [{ "id": "issue-detail", "label": "Issue Detail" }],
    "contextMenuItems": [
      { "id": "copy-path", "label": "Copy Path", "when": "*" },
      { "id": "preview", "label": "Open as Preview", "when": "*.{md,json,png}" }
    ],
    "events": ["workspace:created", "workspace:closed"],
    "settings": {
      "fields": {
        "maxItems": {
          "type": "number",
          "title": "Maximum items",
          "description": "How many items to show",
          "default": 50
        },
        "theme": {
          "type": "select",
          "title": "Color scheme",
          "default": "auto",
          "options": [
            { "label": "Auto", "value": "auto" },
            { "label": "Dark", "value": "dark" },
            { "label": "Light", "value": "light" }
          ]
        }
      }
    }
  }
}
```

---

## Extension API

The `ExtensionAPI` object is passed to your `register()` function. It is the only interface between your extension and the host. Extensions must not import from core paths or `@tauri-apps/api` directly.

### Type Safety

Copy the standalone type file into your project for full TypeScript support:

```bash
curl -O https://raw.githubusercontent.com/TheGnarCo/gnar-term/main/src/extensions/api.ts
```

This file is self-contained (depends only on `svelte/store`).

### Lifecycle

```typescript
export default function register(api: ExtensionAPI) {
  api.onActivate(() => {
    // Called when the extension is activated.
    // Register UI, commands, event handlers here.
  });

  api.onDeactivate(() => {
    // Called when the extension is deactivated or uninstalled.
    // Optional — core automatically cleans up all registrations.
    // Use this for custom cleanup (timers, WebSocket connections, etc.)
  });
}
```

`onActivate` may be `async`. `onDeactivate` must be synchronous.

**Important:** `api.onActivate()` and `api.onDeactivate()` must be called synchronously during the `register()` function — not inside a `setTimeout`, `await`, or other async callback. The host captures these callbacks immediately after `register()` returns. Calling them asynchronously has no effect.

### UI Registration

All registered items are automatically namespaced with your extension id. If your manifest declares `id: "my-ext"` and you register a command `"greet"`, the actual id becomes `"my-ext:greet"`. You never need to namespace manually.

#### Secondary Sidebar Tab

Adds a tab to the right sidebar. Core renders the tab bar; your component fills the content area.

```typescript
api.registerSecondarySidebarTab("files", FileBrowserComponent);
```

The tab's label and icon come from the manifest's `contributes.secondarySidebarTabs` entry with the matching `id`.

#### Secondary Sidebar Action

Adds a button to a tab's control row (the icon bar above the tab content).

```typescript
api.registerSecondarySidebarAction("files", "refresh", () => {
  loadFiles();
});
```

The action's icon and title come from the matching manifest declaration.

#### Primary Sidebar Section

Adds a collapsible section below the Workspaces list in the left sidebar.

```typescript
api.registerPrimarySidebarSection("profile", ProfileCardComponent, {
  collapsible: false, // default: true
  showLabel: false, // default: true
});
```

#### Surface Type

Registers a new pane content type (beyond the built-in terminal).

```typescript
api.registerSurfaceType("preview", PreviewSurfaceComponent);
```

Surfaces are opened via `api.openFile(path)` or through the command palette. Your component receives a `surface` prop with `surfaceTypeId` and optional `props`.

#### Command

Adds an entry to the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).

```typescript
api.registerCommand("refresh-issues", async () => {
  await fetchIssues();
});
```

The command title comes from `contributes.commands` in the manifest.

#### Context Menu Item

Registers a right-click menu item for files. The `when` pattern determines which files it appears for.

```typescript
api.registerContextMenuItem("open-as-preview", (filePath) => {
  api.openFile(filePath);
});
```

The label and `when` pattern come from `contributes.contextMenuItems` in the manifest. Supported patterns:

| Pattern           | Matches                                           |
| ----------------- | ------------------------------------------------- |
| `*`               | All files                                         |
| `*.md`            | Files ending in `.md`                             |
| `*.{png,jpg,gif}` | Files ending in `.png`, `.jpg`, or `.gif`         |
| `directory`       | Directories only (shown via `showDirContextMenu`) |

Matching is case-insensitive for file extension patterns.

### Events

Subscribe to lifecycle events. Extensions **must** declare which events they use in the manifest's `contributes.events` array. This is deny-by-default — omitting `contributes.events` means your extension cannot subscribe to any events. Subscribing to an undeclared event throws an error at runtime.

```typescript
api.on("workspace:created", (event) => {
  console.log(`New workspace: ${event.name}`);
});

api.off("workspace:created", handler); // unsubscribe
```

All subscriptions are automatically cleaned up on deactivate.

The `api.ts` type file exports an `AppEventType` union for compile-time safety:

```typescript
import type { AppEventType } from "./api";
```

#### Available Events

| Event                  | Payload                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `workspace:created`    | `{ id, name }`                                                    |
| `workspace:activated`  | `{ id, previousId }` (`previousId` is `null` on first activation) |
| `workspace:closed`     | `{ id }`                                                          |
| `workspace:renamed`    | `{ id, oldName, newName }`                                        |
| `pane:split`           | `{ parentPaneId, newPaneId, direction }`                          |
| `pane:closed`          | `{ id, workspaceId }`                                             |
| `pane:focused`         | `{ id, previousId }` (`previousId` is `null` on first focus)      |
| `surface:created`      | `{ id, paneId, kind }`                                            |
| `surface:activated`    | `{ id, paneId }`                                                  |
| `surface:closed`       | `{ id, paneId }`                                                  |
| `surface:titleChanged` | `{ id, oldTitle, newTitle }`                                      |
| `sidebar:toggled`      | `{ which, visible }`                                              |
| `theme:changed`        | `{ id, previousId }`                                              |

### Tauri Commands

Call native Rust commands without importing `@tauri-apps/api`. Only allowlisted commands are available — attempting to call a non-allowlisted command (e.g., PTY commands) throws an error.

```typescript
const entries = await api.invoke<DirEntry[]>("list_dir", { path: "/tmp" });
const content = await api.invoke<string>("read_file", {
  path: "/tmp/file.txt",
});
```

**Allowed commands:** `file_exists`, `list_dir`, `read_file`, `read_file_base64`, `write_file`, `ensure_dir`, `remove_dir`, `get_home`, `is_git_repo`, `list_gitignored`, `watch_file`, `unwatch_file`, `show_in_file_manager`, `open_with_default_app`, `find_file`.

#### File System

| Command            | Args                | Returns      | Notes                                      |
| ------------------ | ------------------- | ------------ | ------------------------------------------ |
| `file_exists`      | `{ path }`          | `boolean`    |                                            |
| `list_dir`         | `{ path }`          | `DirEntry[]` | Sorted: dirs first, then alpha             |
| `read_file`        | `{ path }`          | `string`     | Blocked for sensitive paths (~/.ssh, etc.) |
| `read_file_base64` | `{ path }`          | `string`     | Base64-encoded content                     |
| `write_file`       | `{ path, content }` | `void`       | Restricted to `~/.config/gnar-term/`       |
| `ensure_dir`       | `{ path }`          | `void`       | Restricted to `~/.config/gnar-term/`       |
| `remove_dir`       | `{ path }`          | `void`       | Restricted to `~/.config/gnar-term/`       |
| `get_home`         | `{}`                | `string`     | User home directory                        |

```typescript
interface DirEntry {
  name: string;
  is_dir: boolean;
  is_hidden: boolean;
}
```

#### Git

| Command           | Args       | Returns    |
| ----------------- | ---------- | ---------- |
| `is_git_repo`     | `{ path }` | `boolean`  |
| `list_gitignored` | `{ path }` | `string[]` |

#### File Watching

| Command        | Args          | Returns  | Notes              |
| -------------- | ------------- | -------- | ------------------ |
| `watch_file`   | `{ path }`    | `number` | Returns a watch ID |
| `unwatch_file` | `{ watchId }` | `void`   |                    |

Use `api.onFileChanged(watchId, handler)` to receive file change notifications (see [File Watching](#file-watching) below).

#### System

| Command                 | Args       | Returns  |
| ----------------------- | ---------- | -------- |
| `show_in_file_manager`  | `{ path }` | `void`   |
| `open_with_default_app` | `{ path }` | `void`   |
| `find_file`             | `{ name }` | `string` |

### Actions

Convenience methods for common operations:

```typescript
api.openFile("/path/to/readme.md"); // Open in preview surface
api.toggleSecondarySidebar(); // Toggle right sidebar
api.showFileContextMenu(x, y, "/path/to/file"); // Show context menu for file
api.showDirContextMenu(x, y, "/path/to/dir"); // Show context menu for directory

api.createWorkspace("Backend", "/home/user/api"); // Create a new workspace
api.openInEditor("/path/to/file.ts"); // Open in system default editor

const cwd = await api.getActiveCwd(); // CWD of focused terminal
const name = await api.showInputPrompt("Name?"); // Prompt user for text input
```

### Scoped State

Each extension gets isolated, persistent key-value storage:

```typescript
// Write (debounced to disk every 300ms)
api.state.set("lastRefresh", Date.now());
api.state.set("favorites", ["/path/one", "/path/two"]);

// Read (from memory — instant)
const ts = api.state.get<number>("lastRefresh");
const favs = api.state.get<string[]>("favorites");
```

State is stored at `~/.config/gnar-term/extensions/<extension-id>/state.json`. It persists across restarts and is loaded when the extension activates.

### Settings

Extensions declare settings in the manifest and access them at runtime:

```typescript
const max = api.getSetting<number>("maxItems"); // Returns user value or manifest default
const all = api.getSettings(); // All settings, defaults merged
```

User values are stored in `~/.config/gnar-term/settings.json` under `extensions.<id>.settings`.

### Clipboard

Read and write the system clipboard:

```typescript
const text = await api.readClipboard();
await api.writeClipboard("copied text");
```

### File Watching

Watch a file for changes and receive callbacks when it updates:

```typescript
const watchId = await api.invoke<number>("watch_file", {
  path: "/path/to/file",
});

const unsubscribe = api.onFileChanged(watchId, (event) => {
  console.log(`File changed: ${event.path}`);
  console.log(`New content: ${event.content}`); // empty string for files > 512KB
});

// Later: stop watching
await api.invoke("unwatch_file", { watchId });
unsubscribe(); // also clean up the event listener
```

Listeners are automatically cleaned up when the extension is deactivated.

### Read-Only Stores

Svelte readable stores for observing app state:

```typescript
import type { Readable } from "svelte/store";
import type { WorkspaceRef, PaneRef, SurfaceRef } from "./api";

api.workspaces; // Readable<WorkspaceRef[]>   — { id, name }
api.activeWorkspace; // Readable<WorkspaceRef | null>
api.activePane; // Readable<PaneRef | null>  — { id, surfaces, activeSurfaceId }
api.activeSurface; // Readable<SurfaceRef | null> — { id, kind, title, hasUnread }
api.theme; // Readable<ThemeDef>   — { bg, fg, fgDim, accent, border, ... }
api.settings; // Readable<Record<string, unknown>> — scoped to this extension's settings only
```

In Svelte components, use the `$` prefix for auto-subscription:

```svelte
<script>
  const theme = api.theme;
  const activeWorkspace = api.activeWorkspace;
</script>

<div style="color: {$theme.fg};">
  Active workspace: {$activeWorkspace?.name}
</div>
```

---

## Writing Extension Components

Extension UI is built with Svelte. Core wraps your component in an `ExtensionWrapper` that injects the API via Svelte context.

### Accessing the API in Components

Use Svelte's `getContext` with the `EXTENSION_API_KEY` constant:

```svelte
<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI, type DirEntry } from "./api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const activeWorkspace = api.activeWorkspace;

  let data: DirEntry[] = [];

  async function load() {
    const cwd = await api.getActiveCwd();
    if (cwd) {
      data = await api.invoke<DirEntry[]>("list_dir", { path: cwd });
    }
  }
</script>

<div style="color: {$theme.fg}; background: {$theme.bg};">
  {#each data as item}
    <div>{item.name}</div>
  {/each}
</div>
```

### Reacting to State Changes

Use Svelte reactive statements with the read-only stores:

```svelte
<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "./api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const activeWorkspace = api.activeWorkspace;

  $: if ($activeWorkspace) {
    loadDataForWorkspace($activeWorkspace.id);
  }
</script>
```

### Theme Integration

Always use `$theme` values for colors. Never hardcode colors — the user may switch themes at any time.

```svelte
<button
  style="
  background: none;
  border: 1px solid {$theme.border};
  color: {$theme.fg};
  border-radius: 4px;
  padding: 4px 8px;
"
>
  Click me
</button>
```

Common theme properties: `bg`, `fg`, `fgDim`, `fgMuted`, `accent`, `border`, `borderActive`, `bgActive`, `bgHighlight`, `bgFloat`, `bgSurface`, `danger`. Additional properties include `accentHover`, `success`, `warning`, `notify`, `sidebarBg`, `sidebarBorder`, `tabBarBg`, `tabBarBorder`, `termBg`, `termFg`, `termCursor`, `termSelection`, and the full `ansi` color set. See `ThemeDef` in `src/lib/theme-data.ts` for the complete list.

---

## Extension Points Summary

| Extension Point          | Where it Appears               | Component?   | Manifest Key                     |
| ------------------------ | ------------------------------ | ------------ | -------------------------------- |
| Secondary sidebar tab    | Right sidebar                  | Yes          | `secondarySidebarTabs`           |
| Secondary sidebar action | Tab control row                | No (handler) | `secondarySidebarTabs[].actions` |
| Primary sidebar section  | Left sidebar, below workspaces | Yes          | `primarySidebarSections`         |
| Surface type             | Pane content area              | Yes          | `surfaces`                       |
| Command                  | Command palette                | No (handler) | `commands`                       |
| Context menu item        | Right-click on files           | No (handler) | `contextMenuItems`               |
| Settings                 | Settings overlay               | No (schema)  | `settings`                       |
| Event subscription       | N/A (background)               | No           | `events`                         |

---

## Extension Lifecycle

```
install → register → activate → [running] → deactivate → unload
                                    ↑             ↓
                                    └── enable ────┘
```

1. **Install** — Manifest is read, validated, and the entry point is loaded via dynamic `import()`.
2. **Register** — Your `register(api)` function is called. Set up `onActivate` and `onDeactivate` callbacks here.
3. **Activate** — Persisted state is loaded from disk. Your `onActivate` callback fires. Register UI, commands, and event handlers.
4. **Running** — Extension is active. Events fire, users interact with your UI.
5. **Deactivate** — Your `onDeactivate` callback fires. All registrations (commands, tabs, sections, surfaces, context menu items) are automatically cleaned up. Event subscriptions are removed. Active surfaces of your type are closed.
6. **Unload** — Extension is removed from the store. State map and timers are cleared.

**Enable/Disable** — Extensions can be toggled without uninstalling. Disabling deactivates and persists `enabled: false` in config. Enabling reactivates and restores state from disk.

### Startup Loading

On app startup, `loadExternalExtensions()` reads `settings.json` and iterates all extension entries. For each entry with `enabled: true` and a `source` field:

1. The `source` path (e.g., `local:/path/to/my-extension`) is resolved
2. The manifest is read and validated from that path
3. The entry point is loaded via dynamic `import()`
4. The extension is registered and activated

Extensions with `enabled: false` are skipped entirely. If the source directory has been moved or deleted, loading fails silently (logged as a warning) and does not prevent other extensions from loading.

### Activation Failure

If an extension's `onActivate` callback throws:

1. **All registry mutations are rolled back** — any commands, sidebar tabs, sidebar sections, surface types, or context menu items registered during the failing activation are automatically unregistered
2. **Event and listener subscriptions are removed** — event bus handlers, Tauri listeners, and file watchers set up during activation are cleaned up
3. **On initial install**, the extension is marked `enabled: false` in config to prevent persistent boot-time failures on every restart
4. **The error is logged** but does not prevent other extensions from loading

This means a partially-activated extension cannot leave orphaned UI elements, event handlers, or file watchers in the system.

---

## Config & Storage

### App Config

Extension install state is stored in `~/.config/gnar-term/settings.json`:

```json
{
  "extensions": {
    "my-extension": {
      "enabled": true,
      "source": "local:/path/to/my-extension",
      "settings": {
        "maxItems": 100
      }
    }
  }
}
```

### Extension State

Each extension gets its own state file at `~/.config/gnar-term/extensions/<id>/state.json`. This file is:

- Created automatically on first `api.state.set()` call
- Loaded into memory on activation
- Written to disk with a 300ms debounce
- Deleted when the extension is uninstalled

### Security

The extension API enforces multiple layers of sandboxing:

- **Invoke allowlist** — Extensions can only call a fixed set of Tauri commands (file system, git, file watching, system). PTY commands (`spawn_pty`, `write_pty`, `kill_pty`, etc.) are blocked — extensions cannot read from or write to terminal sessions.
- **Event filtering** — Extensions can only subscribe to events declared in their manifest's `contributes.events`. Omitting the field means no event access (deny-by-default).
- **Read blocks** — File reads are blocked for sensitive paths: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.config/gcloud`, `~/.docker`, `/etc/shadow`, `/etc/gshadow`
- **Write sandbox** — All writes (`write_file`, `ensure_dir`, `remove_dir`) are restricted to `~/.config/gnar-term/`
- **Path traversal protection** — The `entry` field in manifests cannot contain `..` or start with `/`. Rust-side path validation resolves `..` components before checking the write prefix.
- **Entry point validation** — Extension manifests must use relative paths for `entry`. Absolute paths and traversal attempts are rejected at validation time.

---

## Included Extensions

GnarTerm ships with three included extensions as reference implementations:

### Preview (`src/extensions/preview/`)

Registers a surface type for file preview (Markdown, JSON, images, PDF, CSV, YAML, video, text — 47 file types). Adds a "Preview File..." command and an "Open as Preview" context menu item.

### File Browser (`src/extensions/file-browser/`)

Registers a secondary sidebar tab showing the directory tree of the active terminal's CWD. Adds four context menu items: "Edit" (opens in editor, all files), "Show in File Manager" (all files), "Open with Default App" (all files), and "Open as Workspace" (directories only). Also registers a `toggle-file-browser` command. Refreshes the file tree when the active workspace, pane, or surface changes.

### Profile Card (`src/extensions/profile-card/`)

Registers a primary sidebar section showing user profile info. Demonstrates an extension with a settings schema — exposes `name`, `description`, and `avatarUrl` fields that the user can configure in the Settings overlay.

---

## Developing External Extensions

External extensions live outside the GnarTerm repo. They follow the same manifest + entry point pattern.

### Project Structure

```
my-gnarterm-extension/
  extension.json
  src/
    index.ts          # entry point
    MyComponent.svelte
  dist/
    index.js          # bundled output
  package.json
  tsconfig.json
```

### Build

Extensions must be bundled into a single JS file (the entry point). Use any bundler — Vite, Rollup, esbuild. The output must be an ES module with a default export matching `ExtensionRegisterFn`. A named `register` export is also accepted as a fallback:

```typescript
// Preferred:
export default function register(api: ExtensionAPI): void { ... }
// Also accepted:
export function register(api: ExtensionAPI): void { ... }
```

### Dependencies

Your extension runs inside the GnarTerm WebView. You can use:

- `svelte` and `svelte/store` (provided by the host)
- Any pure JS library you bundle
- Tauri commands via `api.invoke()`

You must **not** import from `@tauri-apps/api` or GnarTerm core paths. All native access goes through `api.invoke()`.

### Testing

Test your extension logic with any test framework. Mock the `ExtensionAPI` interface:

```typescript
const mockApi = {
  onActivate: (cb) => cb(),
  registerCommand: vi.fn(),
  invoke: vi.fn(),
  state: { get: vi.fn(), set: vi.fn() },
  // ... other methods
};

register(mockApi as ExtensionAPI);
expect(mockApi.registerCommand).toHaveBeenCalledWith(
  "my-cmd",
  expect.any(Function),
);
```

### Distribution

Currently supported:

- **Local path** — `installExtensionFromPath("/path/to/extension")`

Planned:

- **GitHub** — clone from a GitHub repo URL
