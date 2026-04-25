---
title: Sidebar Architecture
parent: Architecture
nav_order: 3
---

# Sidebar Architecture

GnarTerm uses a dual-sidebar layout: a **Primary Sidebar** (left) and a **Secondary Sidebar** (right). Both are collapsible and resizable, but they differ in how they organize content and accept new sections.

For term definitions, see the [app-wide glossary](glossary.md).

## Primary Sidebar

The primary sidebar is a **vertically scrolling list of blocks**. New features add sections beneath the existing ones.

- Each block (the **Workspaces** block, the **Workspace Groups** block, any extension section block) has its own collapsible region within the single scrolling column.
- Blocks can be reordered by hovering to reveal a drag grip on the block's left border and dragging it. There is no explicit "reorder mode" — dragging the grip is the only entry point, and releasing or pressing Escape exits it.
- Individual items inside a block (e.g., workspace rows, group rows) use the same hover-grip pattern and reorder only within their own container. Outer-block drag and inner-item drag never share state.
- Drag-drop is implemented with mouse events, not HTML5 DnD (which is broken in Tauri WKWebView). Extensions use `api.createDragReorder({...})` and `api.getComponents().DragGrip` to add reorderable lists without importing core internals.
- When windowed, the top row of the sidebar holds the traffic-light padding and acts as the window drag region. When fullscreen, this row collapses and content shifts to the top edge.
- When adding a new section (e.g., a workspace group section, an extension-supplied panel), append it below the current sections. Do not introduce tabs or horizontal navigation.

## Secondary Sidebar

The secondary sidebar is **tab-controlled**. Each section is its own tab, displayed in a horizontally scrollable tab bar at the top.

- New features register as new tabs.
- Only one tab's content is visible at a time.
- The tab bar scrolls horizontally when tabs exceed the sidebar width.
- Tabs can be reordered by the user.
- When no tabs are registered, the sidebar displays an empty state message.

### Control Row

Below the tab bar, the secondary sidebar has a **control row** — a 28px-tall action bar that matches the height of the surface tab bar. This row is reserved for extension-supplied quick-action buttons (e.g., refresh, filter, settings toggles). The control row only renders when the active tab has registered actions (i.e., when the active tab's action list is non-empty), keeping the UI clean when no actions are available.

## Layout Anatomy

```
+-------------------+-------------------------------+-------------------+
| Primary Sidebar   | TitleBar                      | Secondary Sidebar |
| +               | [<=] GNARTERM [=>]            |                   |
+-------------------+-------------------------------+-------------------+
| Workspaces        | Tab Bar (surfaces)            | Tab Bar (sections)|
|   Workspace 1     | [shell 1] [shell 2] [+]      | [Tab A] [Tab B]   |
|   Workspace 2     |                               | Control Row       |
|                   |                               | [btn] [btn] [btn] |
| Groups            | Terminal / Preview Content     |                   |
|   Group A         |                               | Tab Content       |
| (extension panel) |                               |                   |
+------|------------+-------------------------------+------|------------+
     resize                                              resize
     handle                                              handle
```

## Design Rationale

The asymmetry is intentional:

- The **primary sidebar** favors glanceability. Workspaces, the most-used panel, is always visible at the top. Secondary sections (future: file tree, git, etc.) stack below and can be scanned without switching views.
- The **secondary sidebar** favors depth. Each tab gets the full sidebar height for its content, which suits panels that need more vertical space (future: AI chat, documentation, terminal inspector, extension panels).

## Controls

Sidebar toggle buttons always live in the **TitleBar** — the primary toggle on the left, the secondary toggle on the right. They are always visible regardless of sidebar state. The button color is bright when its sidebar is open, dim when closed.

The **+ New Workspace** button lives at the top of the Workspaces block; **+ New Group** lives at the top of the Workspace Groups block. Both are always visible when their block is present.

## Extending the Sidebars

When building an extension or feature that needs sidebar space:

1. Decide whether the content benefits from being always-visible alongside other sections (primary) or needs dedicated vertical space (secondary).
2. **Primary**: add a new collapsible section component beneath Workspaces.
3. **Secondary**: register a new tab with a label and content component.
4. **Control Row**: for quick actions that should be accessible across all secondary tabs, add buttons to the control row.
