---
title: "ADR-001: Extension Architecture"
parent: Architecture
nav_order: 4
---

# ADR-001: Extension Architecture

**Status:** Accepted
**Date:** 2026-04-09
**Deciders:** alxjrvs

## Context

GnarTerm is growing beyond a terminal workspace manager. Features like git orchestration, GitHub integration, file browsing, and dashboards are planned. Without an extension system, every feature lands in core, making the codebase harder to maintain and forcing all users to carry features they may not want.

We need an extension system that:

- Keeps core lean (terminal + panes + sessions + extension host)
- Allows parallel development of features as independent extensions
- Provides clean extension points for UI, commands, and lifecycle events
- Supports both included (shipped with core) and external (user-installed) extensions

## Decision

### Extension format

An extension is a **directory with a manifest** (`extension.json`) and a bundled JavaScript entry point that exports a `register(api)` function.

- **Included extensions** ship with core, enabled by default (e.g. preview, file browser, profile card)
- **External extensions** are installed from a local path or GitHub, listed in `settings.json`

Extensions render **Svelte components** for UI. Core owns all chrome (tab bars, collapse headers, control rows). Extensions provide content components and metadata only.

No Rust in extensions. Extensions are JS/TS only. Native functionality is accessed through core's existing `invoke` commands.

### Extension manifest (`extension.json`)

```json
{
  "id": "github-issues",
  "name": "GitHub Issues",
  "version": "0.1.0",
  "description": "Browse and manage GitHub issues from the sidebar",
  "entry": "./dist/index.js",
  "included": false,
  "contributes": {
    "secondarySidebarTabs": [
      {
        "id": "issues",
        "label": "Issues",
        "icon": "github",
        "actions": [
          { "id": "refresh", "icon": "refresh", "title": "Refresh Issues" }
        ]
      }
    ],
    "primarySidebarSections": [{ "id": "pr-status", "label": "Pull Requests" }],
    "commands": [{ "id": "refresh-issues", "title": "Refresh Issues" }],
    "surfaces": [{ "id": "issue-detail", "label": "Issue" }],
    "events": ["workspace:created", "workspace:closed"]
  }
}
```

The `contributes` block is declarative. Core reads it to know what slots the extension fills before loading any code. `events` declares which lifecycle events the extension subscribes to; core only dispatches declared events to each extension.

### Extension API

```typescript
// Simplified — see src/extensions/api.ts for the full interface
interface ExtensionAPI {
  // Lifecycle
  onActivate(callback: () => void | Promise<void>): void;
  onDeactivate(callback: () => void): void;

  // Event bus (filtered to declared events in manifest)
  on(event: AppEventType, handler: (payload: unknown) => void): void;
  off(event: AppEventType, handler: (payload: unknown) => void): void;

  // UI registration
  registerSecondarySidebarTab(tabId: string, component: unknown): void;
  registerSecondarySidebarAction(
    tabId: string,
    actionId: string,
    handler: () => void,
  ): void;
  registerPrimarySidebarSection(
    sectionId: string,
    component: unknown,
    options?: { collapsible?: boolean; showLabel?: boolean },
  ): void;
  registerSurfaceType(surfaceId: string, component: unknown): void;
  registerCommand(commandId: string, handler: () => void | Promise<void>): void;
  registerContextMenuItem(
    itemId: string,
    handler: (filePath: string) => void,
  ): void;

  // Tauri command invocation
  invoke<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T>;

  // Actions
  openFile(path: string): void;
  getActiveCwd(): Promise<string | undefined>;
  showInputPrompt(label: string, defaultValue?: string): Promise<string | null>;
  toggleSecondarySidebar(): void;
  createWorkspace(name: string, cwd: string): void;
  openInEditor(filePath: string): void;

  // Context menus
  showFileContextMenu(x: number, y: number, filePath: string): void;
  showDirContextMenu(x: number, y: number, dirPath: string): void;

  // Clipboard
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;

  // File watching
  onFileChanged(
    watchId: number,
    handler: (event: {
      watchId: number;
      path: string;
      content: string;
    }) => void,
  ): () => void;

  // Scoped state
  state: ExtensionStateAPI;

  // Extension settings
  getSetting<T = unknown>(key: string): T | undefined;
  getSettings(): Record<string, unknown>;

  // Read-only core state (Svelte readable stores)
  workspaces: Readable<WorkspaceRef[]>;
  activeWorkspace: Readable<WorkspaceRef | null>;
  activePane: Readable<PaneRef | null>;
  activeSurface: Readable<SurfaceRef | null>;
  theme: Readable<{
    bg: string;
    fg: string;
    accent: string;
    [key: string]: string;
  }>;
  settings: Readable<Record<string, unknown>>;
}
```

### Extension points (v1 — delivered)

| Seam                     | Core owns                                              | Extension owns                                     |
| ------------------------ | ------------------------------------------------------ | -------------------------------------------------- |
| Secondary sidebar tabs   | Tab bar rendering, switching, scrolling, reorder       | Tab label/icon, content component                  |
| Secondary control row    | Icon button rendering, click routing                   | Action declarations (icon + id), handler functions |
| Primary sidebar sections | Collapsible header (label + chevron), expand/collapse  | Content component below header                     |
| Custom surface types     | Surface tab in pane, lifecycle                         | Content component inside pane                      |
| Commands                 | Palette rendering, display                             | Command handler                                    |
| Context menu items       | Menu rendering, file pattern matching                  | Handler function, when pattern                     |
| Overlays                 | Rendering above main content, lifecycle                | Overlay component, props                           |
| Dashboard tabs           | Dashboard overlay, tab bar                             | Tab component, label                               |
| Workspace actions        | Button rendering in sidebar header / project sections  | Handler, icon, visibility filter                   |
| Workspace claiming       | Filtering claimed workspaces from main list            | Claim/unclaim calls                                |
| Settings pages           | Settings overlay, left nav, JSON Schema form rendering | JSON Schema for settings fields                    |

### Config structure

```
~/.config/gnar-term/
  settings.json       # app settings, workspace definitions, extension config
  state.json          # runtime state (open workspaces, sidebar widths, window position)
  extensions/
    <extension-id>/
      extension.json
      dist/index.js
      state.json      # scoped extension state
```

`settings.json` is the primary config file. Legacy `gnar-term.json` and `cmux.json` are still read as fallbacks for backward compatibility. Runtime state is extracted to `state.json` and accessible to extensions read-only.

### Event bus

A typed EventEmitter lives in `src/lib/services/event-bus.ts`. Services emit events after state mutations. Extensions subscribe via `api.on()`. A Svelte store adapter allows components to subscribe reactively.

Events:

- Workspace: `created`, `activated`, `closed`, `renamed`
- Pane: `split`, `closed`, `focused`
- Surface: `created`, `activated`, `closed`, `titleChanged`
- UI: `sidebar:toggled`, `theme:changed`
- Project: `project:dashboard-opened`

### Settings overlay

A new overlay accessible via a gear icon in the TitleBar (left of secondary sidebar toggle). Left nav with settings pages. Core provides "General" and "Extensions" pages. Extensions can register additional pages.

All settings are JSON-representable. Extension settings are declared via JSON Schema in the manifest; core renders them into form UI. Extensions never ship their own settings components.

The Extensions page lists all extensions with enable/disable toggles and install/remove actions. Extensions can be added from local paths or GitHub repositories.

### Included extensions (v1 — delivered)

| Extension            | Type                      | Description                                                              |
| -------------------- | ------------------------- | ------------------------------------------------------------------------ |
| Preview              | Surface type              | File preview (47 file types) — extracted from core                       |
| File Browser         | Secondary sidebar tab     | Directory tree with context menu actions                                 |
| Profile Card         | Primary sidebar section   | Editable user profile card with settings schema                          |
| Managed Workspaces   | Commands + state          | Git worktree-backed workspace lifecycle (create, archive)                |
| Agentic Orchestrator | Passive AI agent detector | Passive AI agent detector with status tracking (requires "observe" perm) |
| GitHub               | Secondary sidebar tab     | Issues, PRs, and commits via `gh` CLI                                    |
| Project Scope        | Primary sidebar section   | Group workspaces into color-coded projects with dashboards               |
| Diff Viewer          | Surface type              | Side-by-side and unified diff display for git changes                    |
| Git Status           | Status registry           | Git branch, PR review, and dirty state in the sidebar                    |

## Alternatives considered

### Web Components for extension UI

Framework-agnostic and well-isolated, but significantly worse DX for a Svelte-native app. Would add complexity for the extension author without clear benefit while we control the ecosystem. Can revisit if third-party extensions become a priority.

### iframes for extension UI

Total isolation but heavy, hard to style consistently, and poor integration with the host app's theme system. Overkill for v1.

### Rust in extensions

Would enable native performance and system access, but requires a Rust toolchain on the user's machine, compilation at install time, and ABI compatibility management. External extensions can access native functionality through core's existing `invoke` commands. Not needed for v1 use cases.

### npm packages as extension format

Standard tooling but adds `node_modules` overhead per extension and couples distribution to npm. Directory-with-manifest is simpler and supports both local and GitHub distribution without a registry dependency.

## Consequences

- Core must be refactored to use registries (command, sidebar, surface) instead of hardcoded lists
- Preview functionality moves from core to an included extension (breaking change to internal structure, not to users)
- `gnar-term.json` is replaced by `settings.json` + `state.json` (clean break)
- Extension authors must use Svelte for UI components (coupling to framework version)
- Settings overlay is a new UI surface that needs design and testing
- Event bus adds overhead to every state mutation (emit after each change)
