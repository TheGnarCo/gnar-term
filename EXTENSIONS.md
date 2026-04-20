---
title: API Reference
parent: Extensions
nav_order: 2
---

# GnarTerm Extension API

GnarTerm ships with an extension system that lets you add sidebar tabs, pane surface types, commands, context menu items, overlays, workspace actions, and settings without modifying core. Extensions are standalone directories with a JSON manifest and a JavaScript entry point — they can live anywhere: in the GnarTerm repo, in a separate project, or in their own git repository.

> **New to extensions?** Start with the [Getting Started Guide](docs/extension-getting-started.md) — build a working extension in 10 minutes, then come back here for the full API reference.

### Extension Documentation

| Document                                                 | Purpose                                                   |
| -------------------------------------------------------- | --------------------------------------------------------- |
| **[Getting Started](docs/extension-getting-started.md)** | Build your first extension from scratch (tutorial)        |
| **[Extension Cookbook](docs/extension-cookbook.md)**     | Step-by-step recipes for common patterns                  |
| **[Development Guide](docs/extension-development.md)**   | Project setup, building, testing, debugging, distribution |
| **[Registry System](docs/registry-system.md)**           | How registries work (architecture deep-dive)              |
| **[Sidebar Architecture](docs/sidebar-architecture.md)** | Sidebar layout rules and guidelines                       |
| **[Glossary](docs/glossary.md)**                         | Definitions for terms used across the codebase            |
| **[ADR-001](docs/adr/001-extension-architecture.md)**    | Architecture decision record (design rationale)           |
| **[ADR-002](docs/adr/002-extension-api-evolution.md)**   | API evolution: badges, indicators, cross-extension events |
| **[Event Contracts](docs/event-contracts.md)**           | Cross-extension event schemas and payload definitions     |

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

| Field         | Type       | Description                                                                                            |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `description` | `string`   | One-line description.                                                                                  |
| `included`    | `boolean`  | `true` for extensions shipped with core. External extensions omit this.                                |
| `permissions` | `string[]` | Elevated permissions. Currently supported: `"pty"`, `"shell"`, `"filesystem"`, `"observe"`. See below. |
| `contributes` | `object`   | Declares what the extension provides. See below.                                                       |

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
    "workspaceActions": [
      {
        "id": "quick-terminal",
        "title": "Quick Terminal",
        "icon": "terminal",
        "shortcut": "⌘⇧T",
        "zone": "workspace"
      }
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

### Permissions

Extensions run with a restricted set of Tauri commands by default. The `permissions` field in the manifest requests elevated access:

| Permission     | Grants access to                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `"pty"`        | `spawn_pty`, `write_pty`, `kill_pty`, `resize_pty`, `get_pty_cwd`, `get_pty_title`, `pause_pty`, `resume_pty`                                |
| `"shell"`      | `run_script` — arbitrary shell command execution in a specified working directory                                                            |
| `"filesystem"` | `copy_files` — copy files matching glob patterns between directories                                                                         |
| `"observe"`    | Read terminal output via `onSurfaceOutput` callback. Fires for every chunk of PTY data on surfaces the extension has registered interest in. |

A warning is logged when an extension with elevated permissions is activated.

### Security Model

Extensions are sandboxed behind the **extension barrier** — they cannot import core modules, stores, or `@tauri-apps/api` directly. All interaction flows through the `ExtensionAPI` and registries:

- **Command allowlist (deny-by-default):** Extensions can only call Tauri commands from a curated allowlist of 29 base commands (read-only file system, git info, GitHub CLI). Elevated commands require explicit permission declarations.
- **Path restrictions:** File-reading commands block access to sensitive directories: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.config/gcloud`, `~/.docker`, `/etc/shadow`, `/etc/gshadow`. Write operations are restricted to `~/.config/gnar-term/` only.
- **Event allowlisting:** Extensions must declare all events they emit or subscribe to in the manifest. Undeclared events throw at runtime.
- **Read-only stores:** Extensions receive read-only projections of workspace, pane, surface, and theme stores. They cannot mutate core state directly.
- **Scoped settings:** Extensions can only access their own settings, not other extensions' configuration or the full app config.
- **Resource cleanup:** On deactivation, all extension registrations (commands, tabs, surfaces, overlays, event handlers, file watchers) are automatically cleaned up. Callback errors do not prevent cleanup.

### Custom Events

Extensions can declare and emit custom events using the `extension:` prefix:

```json
{
  "contributes": {
    "events": ["extension:harness:statusChanged"]
  }
}
```

```typescript
api.emit("extension:harness:statusChanged", { status: "running" });
api.on("extension:harness:statusChanged", (event) => {
  /* ... */
});
```

Custom events follow the same deny-by-default model as core events — they must be declared in the manifest.

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

Adds an entry to the command palette (`Cmd+P` / `Ctrl+P`).

```typescript
api.registerCommand("refresh-issues", async () => {
  await fetchIssues();
});
```

The command title (and optional `shortcut`) come from `contributes.commands` in the manifest. Shortcuts can also be passed at runtime via `registerCommand(id, handler, { shortcut })` — when both are set the runtime value wins.

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

#### Overlay

Registers a full-screen or modal overlay component. Overlays render above the main pane content and are shown/hidden programmatically.

```typescript
import MySettingsPage from "./MySettings.svelte";

// Register the overlay (renders immediately)
api.registerOverlay("settings-page", MySettingsPage, { title: "Settings" });

// Unregister when no longer needed (automatic on deactivation)
api.unregisterOverlay("settings-page");
```

Overlays render as long as they are registered. Register to show, unregister to hide.

#### Dashboard Tab

Registers a tab in the project dashboard overlay. Dashboard tabs appear when a project dashboard is opened.

```typescript
import MyDashTab from "./MyDashTab.svelte";

api.registerDashboardTab("analytics", MyDashTab, { label: "Analytics" });
```

The component receives standard extension context and can access `api` via `getContext`.

#### Workspace Action

Registers an interactive button. The `zone` property controls where it appears:

- **`"workspace"`** (default) — in the workspace header's "+ New" dropdown
- **`"sidebar"`** — in the sidebar top bar, alongside the reorder button

```typescript
// Workspace-zone action (appears in "+ New" dropdown)
api.registerWorkspaceAction("create-worktree", {
  label: "New Worktree",
  icon: "git-branch",
  handler: async (ctx) => {
    // ctx.projectId, ctx.projectPath, ctx.projectName, ctx.isGit available
    const name = await api.showInputPrompt("Branch name?");
    if (name) {
      /* create worktree */
    }
  },
  when: (ctx) => !!ctx.projectPath, // Only show for project workspaces
});

// Sidebar-zone action (appears in top bar)
api.registerWorkspaceAction("create-project", {
  label: "New Project",
  icon: "folder-plus",
  zone: "sidebar",
  handler: async () => {
    /* create project flow */
  },
});
```

The `WorkspaceActionContext` passed to handlers and `when` filters contains:

| Field         | Type       | Description                            |
| ------------- | ---------- | -------------------------------------- |
| `projectId`   | `string?`  | ID of the project context (if any)     |
| `projectPath` | `string?`  | Root directory of the project          |
| `projectName` | `string?`  | Display name of the project            |
| `isGit`       | `boolean?` | Whether the project path is a git repo |

Core passes an empty context `{}` for top-level actions (e.g., sidebar-zone actions that aren't scoped to a specific workspace). Extensions may populate context fields for actions they register.

Use `api.getWorkspaceActions()` to retrieve all registered actions.

#### Workspace Claiming

Allows an extension to "own" workspaces, hiding them from the main Workspaces list and displaying them in the extension's own sidebar section.

```typescript
// Claim a workspace (removes from main list, source is set automatically)
api.claimWorkspace(workspaceId);

// Release a claimed workspace (returns to main list)
api.unclaimWorkspace(workspaceId);
```

Claimed workspaces are typically rendered by the extension's own `PrimarySidebarSection` component.

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
| `workspace:created`    | `{ id, name, metadata? }`                                         |
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
| `worktree:merged`      | `{ worktreePath, branch, baseBranch, repoPath, workspaceId }`     |

### Status Registry

Extensions contribute structured status items to workspaces via the status registry. Items appear in the sidebar's workspace status line, sorted by priority.

```typescript
import type { StatusItem, StatusItemInput } from "./api";
```

**StatusItem fields:**

| Field      | Type                                                        | Description                                             |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `category` | `string`                                                    | Grouping key: `"git"`, `"process"`, `"info"`, or custom |
| `priority` | `number`                                                    | Display order (lower = further left)                    |
| `label`    | `string`                                                    | Display text                                            |
| `variant`  | `"default" \| "success" \| "warning" \| "error" \| "muted"` | Semantic color                                          |
| `tooltip`  | `string?`                                                   | Hover text                                              |
| `icon`     | `string?`                                                   | Icon identifier                                         |
| `action`   | `{ command, args? }?`                                       | Click invokes a registered command                      |
| `metadata` | `Record<string, unknown>?`                                  | Structured data for cross-extension consumption         |

**Well-known metadata keys:**

| Status type | Producer           | Metadata keys                                                   |
| ----------- | ------------------ | --------------------------------------------------------------- |
| Branch      | core (git)         | `repoRoot`, `isDetached`                                        |
| PR          | core (git)         | `prNumber`, `prUrl`, `ciStatus`, `reviewState`, `reviewVariant` |
| Dirty       | core (git)         | `modified`, `untracked`, `staged`                               |
| Agent       | harness extensions | `agentId`, `paneId`                                             |

### Tauri Commands

Call native Rust commands without importing `@tauri-apps/api`. Only allowlisted commands are available — attempting to call a non-allowlisted command (e.g., PTY commands) throws an error.

```typescript
const entries = await api.invoke<DirEntry[]>("list_dir", { path: "/tmp" });
const content = await api.invoke<string>("read_file", {
  path: "/tmp/file.txt",
});
```

**Allowed commands (no permission required):** `file_exists`, `list_dir`, `read_file`, `read_file_base64`, `write_file`, `ensure_dir`, `remove_dir`, `get_home`, `is_git_repo`, `list_gitignored`, `watch_file`, `unwatch_file`, `show_in_file_manager`, `open_with_default_app`, `find_file`, `create_worktree`, `remove_worktree`, `list_worktrees`, `list_branches`, `git_clone`, `push_branch`, `delete_branch`, `git_checkout`, `gh_list_issues`, `gh_list_prs`, `git_log`, `git_status`, `git_diff`, `git_merge`.

**PTY-permission commands (requires `"pty"` in manifest permissions):** `spawn_pty`, `write_pty`, `kill_pty`, `resize_pty`, `get_pty_cwd`, `get_pty_title`, `pause_pty`, `resume_pty`.

**Shell-permission commands (requires `"shell"` in manifest permissions):** `run_script`.

**Filesystem-permission commands (requires `"filesystem"` in manifest permissions):** `copy_files`.

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

#### Git Worktree

| Command           | Args                                         | Returns          |
| ----------------- | -------------------------------------------- | ---------------- |
| `create_worktree` | `{ repo_path, branch, base, worktree_path }` | `void`           |
| `remove_worktree` | `{ repo_path, worktree_path }`               | `void`           |
| `list_worktrees`  | `{ repo_path }`                              | `WorktreeInfo[]` |
| `list_branches`   | `{ repo_path, include_remote }`              | `BranchInfo[]`   |

```typescript
interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  is_bare: boolean;
}
interface BranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}
```

#### Git Operations

| Command         | Args                             | Returns |
| --------------- | -------------------------------- | ------- |
| `git_clone`     | `{ url, target_dir }`            | `void`  |
| `push_branch`   | `{ repo_path, branch, remote? }` | `void`  |
| `delete_branch` | `{ repo_path, branch, remote? }` | `void`  |
| `git_checkout`  | `{ repo_path, branch }`          | `void`  |

#### Git Info

| Command      | Args                                 | Returns        |
| ------------ | ------------------------------------ | -------------- |
| `git_log`    | `{ repo_path, count? }`              | `CommitInfo[]` |
| `git_status` | `{ repo_path }`                      | `FileStatus[]` |
| `git_diff`   | `{ repo_path, file?, base?, head? }` | `string`       |
| `git_merge`  | `{ repo_path, branch }`              | `MergeResult`  |

```typescript
interface CommitInfo {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  subject: string;
  date: string;
}
interface FileStatus {
  path: string;
  status: string;
  staged: string;
}
interface MergeResult {
  success: boolean;
  message: string;
  conflicts?: string[];
}
```

#### GitHub CLI

Requires the [GitHub CLI](https://cli.github.com/) (`gh`) to be installed.

| Command          | Args                    | Returns     |
| ---------------- | ----------------------- | ----------- |
| `gh_list_issues` | `{ repo_path, state? }` | `GhIssue[]` |
| `gh_list_prs`    | `{ repo_path, state? }` | `GhPr[]`    |

```typescript
interface GhAuthor {
  login: string;
}
interface GhLabel {
  name: string;
  color: string;
}
interface GhIssue {
  number: number;
  title: string;
  state: string;
  author: GhAuthor;
  labels: GhLabel[];
  created_at: string;
  url: string;
}
interface GhPr {
  number: number;
  title: string;
  state: string;
  author: GhAuthor;
  labels: GhLabel[];
  created_at: string;
  url: string;
  head_ref_name: string;
  is_draft: boolean;
}
```

#### File Utilities

| Command      | Args                                 | Returns        |
| ------------ | ------------------------------------ | -------------- |
| `copy_files` | `{ source_dir, dest_dir, patterns }` | `number`       |
| `run_script` | `{ cwd, command }`                   | `ScriptOutput` |

```typescript
interface ScriptOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}
```

`copy_files` supports glob patterns with `*` (single segment) and `**` (any depth) and requires the `"filesystem"` permission. `run_script` runs via `sh -c` and requires the `"shell"` permission.

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
// File operations
api.openFile("/path/to/readme.md"); // Open in preview surface
api.openInEditor("/path/to/file.ts"); // Open in system default editor

// Sidebar
api.toggleSecondarySidebar(); // Toggle right sidebar

// Context menus
api.showFileContextMenu(x, y, "/path/to/file"); // Show context menu for file
api.showDirContextMenu(x, y, "/path/to/dir"); // Show context menu for directory

// Workspaces
api.createWorkspace("Backend", "/home/user/api"); // Create a new workspace
api.createWorkspace("Worktree", "/path/to/wt", {
  env: { GNARTERM_WORKTREE_ROOT: "/path" }, // PTY environment variables
  metadata: { branch: "feat/x", repoPath: "/repo" }, // Stored with workspace
});
api.switchWorkspace(workspaceId); // Activate a workspace by ID
api.closeWorkspace(workspaceId); // Close a workspace by ID
api.markSurfaceUnread(surfaceId); // Set unread indicator on a surface tab
api.focusSurface(surfaceId); // Navigate to a surface (switch workspace + select)

// Sidebar tab indicators
api.badgeSidebarTab(tabId, true); // Show notification badge on a sidebar tab
api.badgeSidebarTab(tabId, false); // Clear notification badge
api.activateSidebarTab(tabId); // Switch to a sidebar tab (opens sidebar if closed)

// Workspace indicators (legacy — still works, delegates to status registry)
api.setWorkspaceIndicator(workspaceId, "running"); // Set status indicator on workspace item
api.setWorkspaceIndicator(workspaceId, null); // Clear status indicator

// Workspace status registry — structured status items
api.setStatus(workspaceId, "branch", {
  category: "git",
  priority: 10,
  label: "feat/my-branch",
  variant: "default",
  metadata: { repoRoot: "/path/to/repo" },
});
api.clearStatus(workspaceId, "branch"); // Remove a specific status item
api.clearAllStatus(workspaceId); // Remove all this extension's items for a workspace

// Subscribe to status items (from all extensions) for a workspace
const statusStore = api.getWorkspaceStatus(workspaceId);
statusStore.subscribe((items) => {
  // items: StatusItem[] sorted by priority
});

// Filter by category
const gitStatus = api.getWorkspaceStatusByCategory(workspaceId, "git");
gitStatus.subscribe((items) => {
  const branch = items.find((i) => i.id.endsWith(":branch"));
});

// Desktop notifications
await api.sendNotification("Build complete"); // Title only
await api.sendNotification("Tests passed", "All 847 tests green"); // Title + body

// Surfaces
api.openSurface("dashboard:dashboard", "My Dashboard", { projectId: "abc" }); // Open an extension surface

// User input
const cwd = await api.getActiveCwd(); // CWD of focused terminal
const name = await api.showInputPrompt("Name?"); // Prompt user for text input
const dir = await api.pickDirectory(); // Native directory picker dialog
const result = await api.showFormPrompt("Create Project", [
  { key: "name", label: "Name", placeholder: "My Project" },
  { key: "path", label: "Path", defaultValue: "/home/user" },
  { key: "color", label: "Color", defaultValue: "#4a9eff" },
]); // Multi-field form dialog — returns { name, path, color } or null

// Shared component catalog
const { WorkspaceListView, SplitButton, ColorPicker } = api.getComponents();
```

#### Component Catalog

`api.getComponents()` returns shared UI components that extensions should use
instead of importing core internals. Use `<svelte:component this={...}>` to
render them in your templates.

| Component             | Props                                                                                             | Description                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **WorkspaceListView** | `filterIds?: Set<string>`, `accentColor?: string`                                                 | Workspace list with full interaction (click, close, rename, drag) |
| **SplitButton**       | `label: string`, `onMainClick: () => void`, `dropdownItems: SplitButtonItem[]`, `theme: Readable` | Primary action button with dropdown caret for secondary actions   |
| **ColorPicker**       | `theme: Readable`, `value: string` (bindable), `colors: string[]`                                 | Color swatch grid with custom hex input                           |

```svelte
<script>
  const { SplitButton, ColorPicker } = api.getComponents();
  const theme = api.theme;
</script>

<svelte:component
  this={SplitButton}
  label="+ New"
  onMainClick={handleClick}
  dropdownItems={items}
  {theme}
/>

<svelte:component
  this={ColorPicker}
  bind:value={selectedColor}
  colors={["#4a9eff", "#ff6b6b", "#51cf66"]}
  {theme}
/>
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

### Surface Output

`onSurfaceOutput(callback: (surfaceId: string, data: string) => void): void`

Registers a callback that fires whenever a terminal surface produces output. Requires the `"observe"` permission in the extension manifest. The callback receives the surface ID and the raw output data string. Use this for passive monitoring patterns (e.g., detecting AI agent activity).

```typescript
api.onSurfaceOutput((surfaceId, data) => {
  if (data.includes("Agent finished")) {
    api.setWorkspaceIndicator(workspaceId, "idle");
  }
});
```

### Workspace Subtitle

`registerWorkspaceSubtitle(component: typeof SvelteComponent, priority?: number): void`

Registers a Svelte component to render below the workspace name in the sidebar. Lower priority numbers render first (default: 50; can also be declared in `contributes.workspaceSubtitle.priority`). The component receives a `workspaceId` prop. The core git status service registers the built-in branch/PR/CI subtitle through this same registry.

```typescript
import BranchLabel from "./BranchLabel.svelte";

api.registerWorkspaceSubtitle(BranchLabel, 10);
```

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

### Dashboard Zone Helpers

Query registered content for use in dashboard zones or other dynamic layouts:

```typescript
const tabs = api.getSidebarTabs();
// → [{ id: "files", label: "Files", component: FileBrowser }, ...]

const sections = api.getSidebarSections();
// → [{ id: "profile", label: "Profile", component: ProfileCard }, ...]

const dashTabs = api.getDashboardTabs();
// → [{ id: "analytics", label: "Analytics", component: MyTab, props?: {...} }, ...]
```

All three methods return registered content from all extensions, including the calling extension's own registrations.

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

| Extension Point          | Where it Appears               | Component?   | Manifest Key                        |
| ------------------------ | ------------------------------ | ------------ | ----------------------------------- |
| Secondary sidebar tab    | Right sidebar + dashboard zone | Yes          | `secondarySidebarTabs`              |
| Secondary sidebar action | Tab control row                | No (handler) | `secondarySidebarTabs[].actions`    |
| Primary sidebar section  | Left sidebar + dashboard zone  | Yes          | `primarySidebarSections`            |
| Surface type             | Pane content area              | Yes          | `surfaces`                          |
| Command                  | Command palette                | No (handler) | `commands`                          |
| Context menu item        | Right-click on files           | No (handler) | `contextMenuItems`                  |
| Overlay                  | Full-screen above content      | Yes          | _(registered at runtime)_           |
| Dashboard tab            | Project dashboard              | Yes          | _(registered at runtime)_           |
| Workspace action         | Header or top bar (via `zone`) | No (handler) | `workspaceActions`                  |
| Workspace claiming       | Hides from main workspace list | No           | _(runtime via `claimWorkspace`)_    |
| Settings                 | Settings overlay               | No (schema)  | `settings`                          |
| Event subscription       | N/A (background)               | No           | `events`                            |
| Custom event             | N/A (inter-extension)          | No           | `events` (with `extension:` prefix) |

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

- **Invoke allowlist** — Extensions can only call a fixed set of 29 base Tauri commands (file system, git, git worktree, GitHub CLI, file watching, system). Additional commands require explicit permissions: `"pty"` for terminal sessions (8 commands), `"shell"` for `run_script`, and `"filesystem"` for `copy_files`. A warning is logged when elevated permissions are granted.
- **Event filtering** — Extensions can only subscribe to events declared in their manifest's `contributes.events`. Omitting the field means no event access (deny-by-default).
- **Read blocks** — File reads are blocked for sensitive paths: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.config/gcloud`, `~/.docker`, `/etc/shadow`, `/etc/gshadow`
- **Write sandbox** — All writes (`write_file`, `ensure_dir`, `remove_dir`) are restricted to `~/.config/gnar-term/`
- **Path traversal protection** — The `entry` field in manifests cannot contain `..` or start with `/`. Rust-side path validation resolves `..` components before checking the write prefix.
- **Entry point validation** — Extension manifests must use relative paths for `entry`. Absolute paths and traversal attempts are rejected at validation time.

---

## Included Extensions

GnarTerm ships with included extensions on top of three core surface kinds: terminal, extension, and preview. Preview is core (see `src/lib/services/preview-service.ts` and `src/lib/preview/previewers/`); markdown previews can embed `gnar:<name>` "markdown-component" directives that mount Svelte components registered via `api.registerMarkdownComponent`.

### File Browser (`src/extensions/file-browser/`)

Registers a secondary sidebar tab showing the directory tree of the active terminal's CWD. Adds four context menu items: "Edit" (opens in editor, all files), "Show in File Manager" (all files), "Open with Default App" (all files), and "Open as Workspace" (directories only). Also registers a `toggle-file-browser` command. Refreshes the file tree when the active workspace, pane, or surface changes.

### Agentic Orchestrator (`src/extensions/agentic-orchestrator/`)

Passive AI agent detector with three-layer status tracking (OSC notifications → waiting, title pattern matching → running/idle, idle timeout → idle). Requires `"observe"` permission. Emits `extension:harness:statusChanged` events on status transitions.

### Diff Viewer (`src/extensions/diff-viewer/`)

Registers a surface type for viewing unified diffs with syntax highlighting. Provides commands for showing uncommitted changes, staged changes, file diffs, and branch comparisons. Adds context menu items for file-level diffs. Registers a "Changes" secondary sidebar tab that lists modified files in the active workspace. Listens for the core `worktree:merged` event to auto-refresh the changes view after merge operations. Configurable via settings: diff mode (unified/split), context lines, and whitespace handling.

### Project Scope (`src/extensions/project-scope/`)

Groups workspaces into named projects. Each project appears as a primary sidebar section showing its nested workspaces with a color-coded indicator. Workspaces created while a project is active are auto-associated. Provides "Create Project..." and "Open Project Dashboard..." commands.

### Jrvs Themes (`src/extensions/jrvs-themes/`)

A pack of additional themes (Kirby-inspired). Registers theme entries that show up in the command palette and theme switcher. Pure registration — no UI surfaces.

---

## Developing External Extensions

External extensions live **outside** the GnarTerm repo in their own directory or git repository. They use the exact same manifest + entry point pattern as included extensions — there is no difference in capability. The only distinction is how they're installed: included extensions are bundled with the app; external extensions are installed from a local path.

> **First time?** The [Getting Started Guide](docs/extension-getting-started.md) walks through building an external extension from scratch.

### How external extensions work

1. You create a directory with `extension.json` and a bundled `dist/index.js`
2. You install it in GnarTerm via Settings > Extensions > Install from path
3. GnarTerm validates the manifest, loads the entry point, and activates it
4. The install is persisted to `~/.config/gnar-term/settings.json` so it loads on next startup

The `settings.json` entry looks like this:

```json
{
  "extensions": {
    "my-extension": {
      "enabled": true,
      "source": "local:/absolute/path/to/my-extension"
    }
  }
}
```

### Project structure

```
my-gnarterm-extension/
  extension.json       # manifest — declares metadata and contributions
  src/
    index.ts           # entry point source
    MyComponent.svelte # UI components (optional)
  dist/
    index.js           # bundled output (this is what GnarTerm loads)
  api.ts               # type definitions (copied from GnarTerm repo)
  package.json
  tsconfig.json
  vite.config.ts       # or any bundler config
```

### Build

Extensions must be bundled into a single ES module. Use any bundler — Vite, Rollup, esbuild. The output must have a default export matching `ExtensionRegisterFn`:

```typescript
// Preferred:
export default function register(api: ExtensionAPI): void { ... }
// Also accepted (fallback):
export function register(api: ExtensionAPI): void { ... }
```

**Bundling rules:**

- **ES module format** — `export default function register`
- **Externalize Svelte** — mark `svelte`, `svelte/store`, and `svelte/internal` as external (the host provides these)
- **Single file output** — the `entry` field in your manifest must resolve to one JS file
- **No Tauri imports** — never import from `@tauri-apps/api`; use `api.invoke()` instead

### Dependencies

Your extension runs inside the GnarTerm WebView. You can use:

- **`svelte` and `svelte/store`** — provided by the host; externalize in your build
- **Any pure JS library** — bundle it into your output
- **Tauri commands** — via `api.invoke()` (29 allowlisted base commands for file system, git, GitHub CLI, etc.)

You must **not** import from `@tauri-apps/api` or any GnarTerm `src/lib/` path. All native access goes through `api.invoke()`.

### Testing

Test your extension logic with any test framework. Mock the `ExtensionAPI` interface:

```typescript
const mockApi = {
  onActivate: (cb) => cb(),
  registerCommand: vi.fn(),
  invoke: vi.fn(),
  state: { get: vi.fn(), set: vi.fn() },
  // ... other methods as needed
};

register(mockApi as ExtensionAPI);
expect(mockApi.registerCommand).toHaveBeenCalledWith(
  "my-cmd",
  expect.any(Function),
);
```

See the [Development Guide — Testing](docs/extension-development.md#testing) for a complete mock API pattern and testing strategies.

### Distribution

Extensions are installed from a local directory path. To share an extension:

- **Git repository** — publish your extension as a git repo. Users clone it and install from the local path:

  ```bash
  git clone https://github.com/you/gnarterm-my-extension.git
  cd gnarterm-my-extension && bun install && bun run build
  # Then install from path in GnarTerm Settings > Extensions
  ```

- **Local path** — point GnarTerm at any directory containing a valid `extension.json` and built entry point

The recommended repo layout for a distributable extension:

```
README.md              # what it does, how to install
extension.json         # manifest
src/                   # source code
dist/                  # built output (commit this so users don't need to build)
api.ts                 # type definitions
package.json
```

### Reference: included extensions

The six included extensions in `src/extensions/` are real-world examples of every extension pattern. Use them as reference when building your own:

| Extension               | Patterns demonstrated                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `preview/`              | Surface type, context menu items, file handling                                              |
| `file-browser/`         | Sidebar tab, sidebar action, context menus, workspace actions                                |
| `agentic-orchestrator/` | Observe permission, custom events, status tracking                                           |
| `diff-viewer/`          | Surface type, commands, context menus, core event subscription (`worktree:merged`), settings |
| `project-scope/`        | Primary sidebar section, overlays, workspace claiming, dashboard tabs, color picker          |
| `jrvs-themes/`          | Theme pack registration                                                                      |
