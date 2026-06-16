# GnarTerm Glossary

Canonical definitions for terms used across the codebase, documentation, and extension APIs.

## Core Concepts

| Term | Definition |
|------|-----------|
| **Window** | A native OS window (Tauri window) with its own sidebar and workspace tree. GnarTerm is single-window today; the term is reserved for a future multi-window model. |
| **Workspace** | A named entry in the sidebar and the top-level unit of work. Each workspace owns an independent pane split-tree. A workspace may be standalone, may be the **anchor** of a **workspace group**, or may be a **member** of one. A workspace optionally carries a `worktree` property when backed by a git worktree — a property, not a separate kind of workspace. |
| **Workspace Group** | A collapsible, named region of the sidebar that nests multiple workspaces under a single **anchor** workspace. The group has no identity of its own: it is the anchor plus its ordered members. Groups collapse/expand, reorder by drag, and their grouping, member order, and collapse state persist across launches. |
| **Anchor** | The single workspace that owns a workspace group. The anchor's sidebar row *is* the group's header row — there is no separate header. Members reference their anchor via `anchorWorkspaceId`; the anchor records member order in `memberWorkspaceIds`. |
| **Pane** | A rectangular split region within a workspace that holds one or more surfaces. Panes split horizontally or vertically to form tiled layouts. |
| **Surface** | A single tab inside a pane. A surface's content is a **panel**. Surfaces appear in the pane's tab bar. |
| **Panel** | The content rendered inside a surface. A panel is one of two kinds: a **Terminal** (a PTY-backed shell session) or a **Browser** (a file/Markdown preview — also called Preview). |
| **Split** | A division of a pane into two child panes, either horizontal (side-by-side) or vertical (stacked). Splits are recursive — each child can be split again. |
| **Split Tree** | The recursive data structure (`SplitNode`) that defines a workspace's layout. Leaf nodes are panes; branch nodes are splits with a direction and ratio. |

## UI Regions

| Term | Definition |
|------|-----------|
| **Sidebar** | The left sidebar. A vertically scrolling list of sections, always starting with Workspaces. Collapsible and resizable. It is the only sidebar. |
| **TitleBar** | The 38px-tall bar at the top of the main content area. Contains the GNARTERM title and the sidebar toggle button. Also serves as a window drag region. |
| **Tab Bar** | The 28px-tall horizontal strip at the top of each pane, showing tabs for each surface. Contains controls for splitting, adding surfaces, and closing the pane. |
| **Section** | A discrete content region within the sidebar. Sections stack vertically and can be collapsed. |
| **Resize Handle** | A 4px draggable edge on the inner border of the sidebar and between split panes. Allows the user to adjust sizes by dragging. |
| **Drag Region** | Areas marked with `data-tauri-drag-region` that allow the user to move the application window by clicking and dragging. |

## Controls

| Term | Definition |
|------|-----------|
| **Sidebar Toggle** | A button on the left of the TitleBar that shows or hides the sidebar (⌘B). |
| **Split Divider** | The draggable divider between two panes in a split layout. Adjusts the ratio between the two children (clamped 10%–90%). |
| **Command Palette** | A searchable overlay (Cmd+P) that lists all available actions, workspace commands, and themes. |
| **Context Menu** | A right-click menu that appears on terminals and workspace items, providing contextual actions like copy, paste, split, and close. |

## Data & Backend

| Term | Definition |
|------|-----------|
| **PTY** | Pseudoterminal. The backend process (managed by Rust via `portable-pty`) that runs a shell session. Each terminal surface is connected to a PTY. |
| **PTY ID** | An integer identifier assigned to each PTY process, used for communication between the frontend and Rust backend via Tauri `invoke` calls. |
| **Config** | The user's configuration file (`gnar-term.json` or `cmux.json`), which defines saved workspaces, autoload behavior, and theme preferences. |
| **Theme** | A named color scheme applied to the entire UI, including terminal colors, sidebar, tab bar, and borders. Themes are defined in `theme-data.ts`. |

## Platform

| Term | Definition |
|------|-----------|
| **Window Chrome** | The operating system's native window decorations (close, minimize, maximize buttons). On macOS, these are the "traffic lights" in the top-left corner. |
| **Tauri** | The Rust-based application framework that provides the native window, IPC bridge, and system integration. GnarTerm uses Tauri v2. |
| **WebView** | The browser engine that renders the Svelte frontend. WKWebView on macOS, WebKitGTK on Linux. |
