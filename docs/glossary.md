---
title: Glossary
parent: Architecture
nav_order: 1
---

# GnarTerm Glossary

Canonical definitions for terms used across the codebase, documentation, and extension APIs.

## Core Concepts

| Term           | Definition                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace**  | A named collection of panes arranged in a split tree. Users switch between workspaces in the primary sidebar. Each workspace has an independent layout.                                                                               |
| **Pane**       | A rectangular container within a workspace that holds one or more surfaces. Panes can be split horizontally or vertically to create tiled layouts.                                                                                    |
| **Surface**    | A single view inside a pane. The built-in surface type is **terminal** (a PTY-backed shell session); additional types (e.g., preview, custom viewers) are contributed by extensions. Surfaces appear as tabs in their pane's tab bar. |
| **Split**      | A division of a pane into two child panes, either horizontal (side-by-side) or vertical (stacked). Splits are recursive — each child can be split again.                                                                              |
| **Split Tree** | The recursive data structure (`SplitNode`) that defines a workspace's layout. Leaf nodes are panes; branch nodes are splits with a direction and ratio.                                                                               |

## UI Regions

| Term                  | Definition                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary Sidebar**   | The left sidebar. A vertically scrolling list of sections, always starting with Workspaces. Collapsible and resizable.                                               |
| **Secondary Sidebar** | The right sidebar. Tab-controlled, where each section is a separate tab. Collapsible and resizable.                                                                  |
| **TitleBar**          | The 38px-tall bar at the top of the main content area. Contains the GNARTERM title and sidebar toggle buttons. Also serves as a window drag region.                  |
| **Tab Bar**           | The 28px-tall horizontal strip at the top of each pane, showing tabs for each surface. Contains controls for splitting, adding surfaces, and closing the pane.       |
| **Control Row**       | A 28px-tall action bar in the secondary sidebar, positioned below its tab bar. Hosts extension-supplied quick-action buttons that persist across tab switches.       |
| **Section**           | A discrete content region within a sidebar. In the primary sidebar, sections stack vertically and can be collapsed. In the secondary sidebar, each section is a tab. |
| **Resize Handle**     | A 4px draggable edge on the inner border of each sidebar and between split panes. Allows the user to adjust sizes by dragging.                                       |
| **Drag Region**       | Areas marked with `data-tauri-drag-region` that allow the user to move the application window by clicking and dragging.                                              |

## Controls

| Term                | Definition                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Sidebar Toggle**  | A button in the TitleBar that shows or hides a sidebar. The primary toggle is on the left; the secondary toggle is on the right.   |
| **Split Divider**   | The draggable divider between two panes in a split layout. Adjusts the ratio between the two children (clamped 10%–90%).           |
| **Command Palette** | A searchable overlay (Cmd+P) that lists all available actions, workspace commands, and themes.                                     |
| **Context Menu**    | A right-click menu that appears on terminals and workspace items, providing contextual actions like copy, paste, split, and close. |

## Data & Backend

| Term          | Definition                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PTY**       | Pseudoterminal. The backend process (managed by Rust via `portable-pty`) that runs a shell session. Each terminal surface is connected to a PTY.                                                                                     |
| **PTY ID**    | An integer identifier assigned to each PTY process, used for communication between the frontend and Rust backend via Tauri `invoke` calls.                                                                                           |
| **Settings**  | The user's configuration file (`settings.json`, or legacy `gnar-term.json`/`cmux.json`). Defines theme, font, workspace definitions, autoload behavior, and extension configuration. Located at `~/.config/gnar-term/settings.json`. |
| **App State** | Runtime state persisted to `~/.config/gnar-term/state.json`. Written on quit, restored on launch. Includes sidebar widths/visibility and window bounds. Not user-edited.                                                             |
| **Theme**     | A named color scheme applied to the entire UI, including terminal colors, sidebar, tab bar, and borders. Themes are defined in `theme-data.ts`.                                                                                      |

## Extensions

| Term                    | Definition                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claimed Workspace**   | A workspace that an extension has marked as "owned" via `api.claimWorkspace()`. Claimed workspaces are hidden from the main Workspaces list and displayed in the extension's own sidebar section instead (e.g., workspace-groups claims workspaces belonging to a group).                                                       |
| **Dashboard Tab**       | A tab within a project dashboard overlay. Extensions register dashboard tabs via `api.registerDashboardTab()` to contribute content to the dashboard view.                                                                                                                                                                      |
| **Event Bus**           | The typed publish-subscribe system (`src/lib/services/event-bus.ts`) that services use to emit lifecycle events and extensions subscribe to via `api.on()`/`api.off()`.                                                                                                                                                         |
| **Extension**           | A loadable module that adds functionality to GnarTerm via the ExtensionAPI. Can be "included" (bundled with the app) or "external" (installed from disk).                                                                                                                                                                       |
| **Extension API**       | The sandboxed interface (`ExtensionAPI`) that extensions use to interact with core services. Defined in `src/extensions/api.ts`.                                                                                                                                                                                                |
| **Extension Barrier**   | The architectural boundary ensuring extensions never import core stores, services, or components directly. All extension interaction flows through the `ExtensionAPI` and registries. Enforced by: invoke allowlist, event filtering, read-only store projections, and namespaced APIs.                                         |
| **Extension State**     | Scoped key-value storage persisted to disk per extension, accessed via `api.state.get/set`.                                                                                                                                                                                                                                     |
| **Manifest**            | The `extension.json` file that declares an extension's metadata, contributions, and entry point.                                                                                                                                                                                                                                |
| **Overlay**             | A full-screen or modal component rendered above the main pane content. Extensions register overlays via `api.registerOverlay()` for settings dialogs, dashboards, and custom modal UIs.                                                                                                                                         |
| **Workspace Group**     | A user-created, path-rooted, colored grouping of workspaces. Renders inline in the Workspaces section as a banner with a nested list of its workspaces, and owns a Dashboard workspace hosting a markdown Live Preview. Managed by the workspace-groups extension. (Formerly: "Project"; see ADR 004.)                          |
| **Registry**            | A store-backed collection for a specific contribution type (commands, tabs, sections, surfaces, overlays, context menu items, workspace actions, etc.). Built on the generic `createRegistry()` factory. Supports register, unregister, and `unregisterBySource()` for extension cleanup.                                       |
| **Settings Overlay**    | The full-screen settings UI accessible from the TitleBar gear icon. Contains General settings and per-extension settings pages.                                                                                                                                                                                                 |
| **Sidebar Tab**         | A tab in the secondary (right) sidebar. Each tab has an id, label, icon, and content component. Tabs are rendered in a horizontal tab bar; only the active tab's content is visible.                                                                                                                                            |
| **Surface Type**        | A registered component type that can render in a pane. Terminal is built-in; extensions register additional types (e.g., preview, custom viewers) via `api.registerSurfaceType()`.                                                                                                                                              |
| **Workspace Action**    | An interactive button registered by extensions. The `zone` property controls placement: `"workspace"` (default) renders in the workspace header's "+ New" dropdown; `"sidebar"` renders in the sidebar top bar. Has an icon, label, handler, and optional visibility condition. Registered via `api.registerWorkspaceAction()`. |
| **Diff Viewer**         | A surface type contributed by the diff-viewer extension that renders unified diffs with syntax highlighting. Used for showing uncommitted changes, staged changes, and branch comparisons.                                                                                                                                      |
| **Event Contract**      | A documented agreement between extensions about the shape and semantics of custom events. Event contracts define the event name, payload schema, and which extensions emit or subscribe. Documented in `docs/event-contracts.md`.                                                                                               |
| **Sidebar Tab Badge**   | A visual indicator (dot) displayed on a secondary sidebar tab to signal unread activity. Set via `api.badgeSidebarTab(tabId, true)` and cleared via `api.badgeSidebarTab(tabId, false)`.                                                                                                                                        |
| **Surface Badge**       | An unread marker on a surface tab indicating pending attention (e.g., an agent waiting for input). Set via `api.markSurfaceUnread()`.                                                                                                                                                                                           |
| **Workspace Indicator** | A colored status dot displayed on workspace items in the primary sidebar, conveying at-a-glance status (e.g., agent running, waiting, idle). Set via `api.setWorkspaceIndicator()`.                                                                                                                                             |

## Platform

| Term              | Definition                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Window Chrome** | The operating system's native window decorations (close, minimize, maximize buttons). On macOS, these are the "traffic lights" in the top-left corner. |
| **Tauri**         | The Rust-based application framework that provides the native window, IPC bridge, and system integration. GnarTerm uses Tauri v2.                      |
| **WebView**       | The browser engine that renders the Svelte frontend. WKWebView on macOS, WebKitGTK on Linux.                                                           |
