# Sidebar Architecture

GnarTerm uses a dual-sidebar layout: a **Primary Sidebar** (left) and a **Secondary Sidebar** (right). Both are collapsible and resizable, but they differ in how they organize content and accept new sections.

For term definitions, see the [app-wide glossary](glossary.md).

## Primary Sidebar

The primary sidebar is a **vertically scrolling list of sections**. New features add sections beneath the existing ones.

- The **Workspaces** section is always the first section and cannot be reordered below other sections.
- Sections below Workspaces can be reordered by the user.
- Each section occupies a collapsible region within the single scrolling column.
- The header row contains only the new workspace button (+). Sidebar toggles live in the TitleBar.
- When adding a new section (e.g., a file browser, git status panel), append it below the current sections. Do not introduce tabs or horizontal navigation.

## Secondary Sidebar

The secondary sidebar is **tab-controlled**. Each section is its own tab, displayed in a horizontally scrollable tab bar at the top.

- New features register as new tabs.
- Only one tab's content is visible at a time.
- The tab bar scrolls horizontally when tabs exceed the sidebar width.
- Tabs can be reordered by the user.
- When no tabs are registered, the sidebar displays an empty state message.

### Control Row

Below the tab bar, the secondary sidebar has a **control row** — a 28px-tall action bar that matches the height of the surface tab bar. This row is reserved for extension-supplied quick-action buttons (e.g., refresh, filter, settings toggles). The control row is always visible regardless of which tab is active, making it suitable for cross-tab actions.

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
| (future sections) | Terminal / Preview Content     |                   |
|   File Browser    |                               | Tab Content       |
|   Git Status      |                               |                   |
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

The new workspace button (+) lives in the primary sidebar's header row and is only visible when the primary sidebar is open.

## Extending the Sidebars

When building an extension or feature that needs sidebar space:

1. Decide whether the content benefits from being always-visible alongside other sections (primary) or needs dedicated vertical space (secondary).
2. **Primary**: add a new collapsible section component beneath Workspaces.
3. **Secondary**: register a new tab with a label and content component.
4. **Control Row**: for quick actions that should be accessible across all secondary tabs, add buttons to the control row.
