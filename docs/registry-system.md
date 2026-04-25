---
title: Registry System
parent: Architecture
nav_order: 2
---

# Registry System

GnarTerm uses a **store-backed registry pattern** as the primary mechanism for extensions to contribute UI elements, commands, and behaviors to the host application. Every extension contribution — sidebar tabs, commands, overlays, workspace actions — flows through a registry.

## Architecture

```
Extension                     Registry                       UI Component
─────────                     ────────                       ────────────
api.registerCommand()  ──►  commandStore (Svelte store)  ──►  CommandPalette.svelte
api.registerSidebarTab()──► sidebarTabStore              ──►  SecondarySidebar.svelte
api.registerOverlay()  ──►  overlayStore                 ──►  App.svelte
```

All registries follow the same contract:

1. Extensions **register** items through the `ExtensionAPI`
2. Items are stored in a **Svelte writable store** (reactive)
3. UI components **subscribe** to the store and render dynamically
4. On extension deactivation, items are cleaned up via **`unregisterBySource(extensionId)`**

## Generic Factory

All registries are built on a single generic factory: `createRegistry<T>()` in `src/lib/services/create-registry.ts`.

```typescript
import { createRegistry, type RegistryItem } from "./create-registry";

// Every registry item must have an `id` and `source`
interface RegistryItem {
  id: string;
  source: string;
}

// The factory returns a registry with these operations:
const registry = createRegistry<MyItem>();

registry.register(item); // Add or replace by id
registry.unregister(id); // Remove by id
registry.unregisterBySource(source); // Remove all from a source extension
registry.get(id); // Lookup by id
registry.reorder(fromIdx, toIdx); // Drag-reorder support
registry.reset(); // Clear all items
registry.store; // Readable<T[]> — subscribe in components
```

The `source` field on every item enables automatic cleanup. When an extension is deactivated, the extension loader calls `unregisterBySource(extensionId)` on every registry, removing all contributions from that extension without affecting others.

## Registry Catalog

### UI Registries

| Registry               | File                            | Store Export           | What It Holds                                             |
| ---------------------- | ------------------------------- | ---------------------- | --------------------------------------------------------- |
| **Sidebar Tabs**       | `sidebar-tab-registry.ts`       | `sidebarTabStore`      | Secondary sidebar tabs (id, label, icon, component)       |
| **Sidebar Sections**   | `sidebar-section-registry.ts`   | `sidebarSectionStore`  | Primary sidebar sections (id, label, component, order)    |
| **Surface Types**      | `surface-type-registry.ts`      | `surfaceTypeStore`     | Renderable pane content types (id, label, component)      |
| **Overlays**           | `overlay-registry.ts`           | `overlayStore`         | Full-screen/modal overlays (id, component, props)         |
| **Dashboard Tabs**     | `dashboard-tab-registry.ts`     | `dashboardTabStore`    | Group dashboard tabs (id, label, component)               |
| **Context Menu Items** | `context-menu-item-registry.ts` | `contextMenuItemStore` | Right-click menu items (id, label, when pattern, handler) |

### Behavioral Registries

| Registry              | File                           | Store Export           | What It Holds                                                                                                               |
| --------------------- | ------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Commands**          | `command-registry.ts`          | `commandStore`         | Command palette entries (id, title, shortcut, action)                                                                       |
| **Workspace Actions** | `workspace-action-registry.ts` | `workspaceActionStore` | Action buttons with zone targeting: workspace header or sidebar top bar (id, icon, label, zone, handler, visibility filter) |

### Special-Purpose Registries

| Registry                    | File                                 | Store Export                   | What It Holds                                                                              |
| --------------------------- | ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| **Claimed Workspaces**      | `claimed-workspace-registry.ts`      | `claimedWorkspaceIds`          | Workspace IDs "owned" by extensions (hidden from main list)                                |
| **Event Bus**               | `event-bus.ts`                       | N/A (pub-sub, not store-based) | Typed lifecycle event subscriptions                                                        |
| **Workspace Subtitle**      | `workspace-subtitle-registry.ts`     | N/A                            | Components rendered below workspace names in the sidebar                                   |
| **Status**                  | `status-registry.ts`                 | N/A                            | Workspace status items shown in the status line and sidebar indicators                     |
| **Dashboard Contributions** | `dashboard-contribution-registry.ts` | `dashboardContributionStore`   | Kinds of dashboard that can attach to a Workspace Group (e.g., group, agentic)             |
| **Pseudo-Workspaces**       | `pseudo-workspace-registry.ts`       | `pseudoWorkspaceStore`         | Pinned synthetic workspaces (non-persisted, non-deletable; e.g., Global Agentic Dashboard) |
| **Root Row Renderers**      | `root-row-renderer-registry.ts`      | N/A                            | Svelte components that render non-workspace rows (groups, dashboards) in the sidebar list  |
| **TitleBar Buttons**        | `titlebar-button-registry.ts`        | `titleBarButtonStore`          | Extension-supplied icon buttons rendered in the TitleBar                                   |
| **Markdown Components**     | `markdown-component-registry.ts`     | N/A                            | Live Svelte widgets embeddable inside markdown previews via `gnar:<name>` fences           |
| **Child Row Contributors**  | `child-row-contributor-registry.ts`  | N/A                            | Extensions that contribute child rows to another extension's parent rows                   |

## Data Flow Example

Here's how a sidebar tab flows from extension to UI:

```
1. Extension calls api.registerSecondarySidebarTab({
     id: "files", label: "Files", icon: "folder", component: FileBrowser
   })

2. ExtensionAPI namespaces the id → "file-browser:files"
   and adds source: "file-browser"

3. Extension loader calls sidebarTabRegistry.register(item)

4. sidebarTabStore (Svelte Readable<SidebarTab[]>) updates

5. SecondarySidebar.svelte subscribes to $sidebarTabStore
   and renders tab headers + active tab content

6. On deactivation: unregisterBySource("file-browser")
   removes all tabs from that extension
```

## Adding a New Registry

If you need a new extension contribution type:

1. Create `src/lib/services/my-registry.ts`
2. Define your item interface extending `RegistryItem` (must have `id` and `source`)
3. Call `createRegistry<MyItem>()` and export the store + `unregisterBySource` operations
4. Add registration methods to `ExtensionAPI` in `src/extensions/api.ts`
5. Wire up the API method in `src/lib/services/extension-loader.ts`
6. Add `unregisterBySource` to `REGISTRY_CLEANUP_FNS` in extension-loader (array-driven, not manual)
7. Subscribe to the store in the relevant UI component

## Event Bus

The event bus (`src/lib/services/event-bus.ts`) is not a registry but serves a complementary role. While registries handle **UI contributions**, the event bus handles **lifecycle notifications**:

| Event                  | Emitted When                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `workspace:created`    | New workspace added                                                |
| `workspace:activated`  | User switches workspace                                            |
| `workspace:closed`     | Workspace removed                                                  |
| `workspace:renamed`    | Workspace name changed                                             |
| `pane:split`           | Pane split into two                                                |
| `pane:closed`          | Pane removed from layout                                           |
| `pane:focused`         | Active pane changes                                                |
| `surface:created`      | New surface added to pane                                          |
| `surface:activated`    | Active surface changes in pane                                     |
| `surface:closed`       | Surface removed from pane                                          |
| `surface:titleChanged` | Surface title updated                                              |
| `sidebar:toggled`      | Sidebar visibility changed                                         |
| `theme:changed`        | Theme switched                                                     |
| `worktree:merged`      | Worktree branch merged to base                                     |
| `surface:ptyReady`     | PTY assigned to a terminal surface (fires after `surface:created`) |
| `agent:statusChanged`  | Detected AI agent transitions state (running/waiting/idle/closed)  |

Extensions subscribe via `api.on(type, handler)` and must declare events in their manifest's `contributes.events` array (deny-by-default).

## Design Principles

1. **Registries are the only extension → UI bridge.** Extensions never import components or modify DOM directly.
2. **Source tracking enables safe cleanup.** Every item knows which extension registered it.
3. **Stores are reactive.** UI updates automatically when registrations change — no manual refresh needed.
4. **One factory, many registries.** `createRegistry<T>()` eliminates boilerplate while allowing type-safe specialization.

## Related Docs

- [Getting Started](extension-getting-started.md) — Build your first extension
- [EXTENSIONS.md](../EXTENSIONS.md) — Full API reference
- [Extension Cookbook](extension-cookbook.md) — Recipes for common patterns
- [Development Guide](extension-development.md) — Project setup, build, test, debug
- [Glossary](glossary.md) — Term definitions
