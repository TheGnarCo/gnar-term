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

| Term                 | Definition                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Event Bus**        | The typed publish-subscribe system (`src/lib/services/event-bus.ts`) that services use to emit lifecycle events and extensions subscribe to.                                             |
| **Extension**        | A loadable module that adds functionality to GnarTerm via the ExtensionAPI. Can be "included" (bundled with the app) or "external" (installed from disk).                                |
| **Extension API**    | The sandboxed interface (`ExtensionAPI`) that extensions use to interact with core services. Defined in `src/extensions/api.ts`.                                                         |
| **Extension State**  | Scoped key-value storage persisted to disk per extension, accessed via `api.state.get/set`.                                                                                              |
| **Manifest**         | The `extension.json` file that declares an extension's metadata, contributions, and entry point.                                                                                         |
| **Registry**         | A store-backed collection for a specific contribution type (commands, sidebar tabs, sidebar sections, surface types, context menu items). Built on the generic `createRegistry` factory. |
| **Settings Overlay** | The full-screen settings UI accessible from the TitleBar gear icon. Contains General settings and per-extension settings pages.                                                          |
| **Surface Type**     | A registered component type that can render in a pane. Terminal is built-in; extensions register additional types (e.g., preview, custom viewers).                                       |

## Platform

| Term              | Definition                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Window Chrome** | The operating system's native window decorations (close, minimize, maximize buttons). On macOS, these are the "traffic lights" in the top-left corner. |
| **Tauri**         | The Rust-based application framework that provides the native window, IPC bridge, and system integration. GnarTerm uses Tauri v2.                      |
| **WebView**       | The browser engine that renders the Svelte frontend. WKWebView on macOS, WebKitGTK on Linux.                                                           |
