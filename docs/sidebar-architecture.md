# Sidebar Architecture

GnarTerm has a single **Sidebar** on the left. It is collapsible and resizable.

For term definitions, see the [app-wide glossary](glossary.md).

> **History:** GnarTerm previously had a second, tab-controlled sidebar on the
> right (the "secondary sidebar"). It was removed — there is now one sidebar.
> Extension content that used to target the secondary sidebar now renders in
> this sidebar.

## Sidebar

The sidebar is a **vertically scrolling list of sections**. New features add
sections beneath the existing ones.

- The **Workspaces** section is always the first section and cannot be reordered below other sections.
- Sections below Workspaces can be reordered by the user.
- Each section occupies a collapsible region within the single scrolling column.
- The header row contains only the new workspace button (+). The sidebar toggle lives in the TitleBar.
- When adding a new section (e.g., a file browser, git status panel), append it below the current sections. Do not introduce tabs or horizontal navigation.

## Layout Anatomy

```
+-------------------+-------------------------------+
| Sidebar           | TitleBar                      |
| +               | [<=] GNARTERM                |
+-------------------+-------------------------------+
| Workspaces        | Tab Bar (surfaces)            |
|   Workspace 1     | [shell 1] [shell 2] [+]      |
|   Workspace 2     |                               |
|                   |                               |
| (future sections) | Terminal / Preview Content     |
|   File Browser    |                               |
|   Git Status      |                               |
+------|------------+-------------------------------+
     resize
     handle
```

## Design Rationale

The sidebar favors glanceability. Workspaces, the most-used panel, is always
visible at the top. Secondary sections (future: file tree, git, etc.) stack
below and can be scanned without switching views.

## Controls

The sidebar toggle button lives on the left of the **TitleBar** — never in the
sidebar header. It is always visible regardless of sidebar state. The button
color is bright when the sidebar is open, dim when closed.

The new workspace button (+) lives in the sidebar's header row and is only
visible when the sidebar is open.

## Extending the Sidebar

When building an extension or feature that needs sidebar space, add a new
collapsible section component beneath Workspaces.

Extensions declare sections at runtime via the MCP `render_sidebar` tool
(remove them with `remove_sidebar_section`). Sections are workspace-scoped: a
section declared in workspace A is invisible from workspace B. See
`src/lib/stores/extension-sidebar.ts` and `src/lib/services/mcp-server.ts`.
