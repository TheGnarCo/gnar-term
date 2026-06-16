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

## Workspaces Section — Nested Tree

The Workspaces section is a **nested tree**, not a flat list. Standalone
workspaces and **workspace groups** share one ordered column, sequenced by the
`workspaceOrder` store rather than by raw array index.

- **Anchor row = group header.** A workspace group has no separate header row.
  The **anchor** workspace's own row *is* the group header — it renders the group
  name, controls, and the collapse chevron inline. A standalone workspace is a
  degenerate group: it renders as an ordinary row with no chevron and no nested
  list.
- **Collapse chevron.** Groups with one or more members show a chevron on the
  anchor row that expands/collapses the nested member list. Collapse state is
  keyed by the anchor's workspace id and persists across launches.
- **Indented members.** When expanded, member workspaces render as indented rows
  beneath the anchor row, in the order recorded by the anchor's
  `memberWorkspaceIds`. Members are plain workspaces; membership is derived from
  each member's `anchorWorkspaceId` back-reference, and the indented list shows
  ordering only.
- **Nested drag.** Drag reordering operates at two levels: top-level rows
  (standalone workspaces and group anchors) reorder within `workspaceOrder`, and
  members reorder within their group's member list. Drop targets render a
  rail-flush drop ghost.
- **Collapsed-rail mode.** When the sidebar is collapsed, the Workspaces section
  renders as a narrow vertical rail. Each row is reduced to a thin colored stripe
  (wider for the active workspace, narrower otherwise); hovering a row reveals a
  floating popover of the full row/group at the row's vertical position, so a
  collapsed sidebar stays navigable without expanding.

## Layout Anatomy

```
+-------------------+-------------------------------+
| Sidebar           | TitleBar                      |
| +               | [<=] GNARTERM                |
+-------------------+-------------------------------+
| Workspaces        | Tab Bar (surfaces)            |
|   Standalone WS   | [shell 1] [shell 2] [+]      |
|   v Anchor (grp)  |                               |
|       Member 1    |                               |
|       Member 2    |                               |
|   Workspace 2     |                               |
|                   |                               |
| (future sections) | Terminal / Browser Content     |
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
