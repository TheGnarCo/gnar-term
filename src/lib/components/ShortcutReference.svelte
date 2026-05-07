<script lang="ts">
  import { theme } from "../stores/theme";

  /**
   * Reference panel for every keyboard shortcut wired into the app.
   * Rendered as the body of the `gnar-term:keyboard-shortcuts` dashboard
   * workspace. macOS bindings use ⌘/⇧, Linux/Windows uses Ctrl+/Shift+.
   */

  interface ShortcutRow {
    label: string;
    mac: string;
    other: string;
  }

  interface ShortcutSection {
    title: string;
    rows: ShortcutRow[];
  }

  const sections: ShortcutSection[] = [
    {
      title: "Navigation",
      rows: [
        { label: "Switch Workspace 1-9", mac: "⌘1-9", other: "—" },
        {
          label: "Select Surface/Tab 1-9",
          mac: "Ctrl+1-9",
          other: "Ctrl+1-9",
        },
        {
          label: "Next Workspace",
          mac: "⌘⇧]",
          other: "Ctrl+Shift+]",
        },
        {
          label: "Prev Workspace",
          mac: "⌘⇧[",
          other: "Ctrl+Shift+[",
        },
        {
          label: "Cycle Workspace Forward",
          mac: "Ctrl+Tab",
          other: "Ctrl+Tab",
        },
        {
          label: "Cycle Workspace Back",
          mac: "Ctrl+Shift+Tab",
          other: "Ctrl+Shift+Tab",
        },
        {
          label: "Switch to Last Workspace",
          mac: "⌘`",
          other: "Ctrl+Shift+`",
        },
        { label: "Focus Pane Left", mac: "Alt+⌘←", other: "Ctrl+Alt+←" },
        { label: "Focus Pane Right", mac: "Alt+⌘→", other: "Ctrl+Alt+→" },
        { label: "Focus Pane Up", mac: "Alt+⌘↑", other: "Ctrl+Alt+↑" },
        { label: "Focus Pane Down", mac: "Alt+⌘↓", other: "Ctrl+Alt+↓" },
      ],
    },
    {
      title: "Panes",
      rows: [
        { label: "Split Right", mac: "⌘D", other: "Ctrl+Shift+D" },
        {
          label: "Split Down",
          mac: "⌘⇧D",
          other: "Ctrl+Shift+E",
        },
        {
          label: "Resize Pane",
          mac: "⌘⇧←→↑↓",
          other: "Ctrl+Shift+←→↑↓",
        },
        {
          label: "Toggle Pane Zoom",
          mac: "⌘⇧Enter",
          other: "Ctrl+Shift+Enter",
        },
        {
          label: "Flash Focused Pane",
          mac: "⌘⇧H",
          other: "Ctrl+Shift+H",
        },
        {
          label: "Close Pane",
          mac: "⌘⇧X",
          other: "Ctrl+Shift+X",
        },
      ],
    },
    {
      title: "Surfaces",
      rows: [
        { label: "New Workspace", mac: "⌘N", other: "—" },
        { label: "New Terminal", mac: "⌘T", other: "—" },
        { label: "Close Terminal", mac: "⌘W", other: "Ctrl+Shift+W" },
        {
          label: "Close Workspace",
          mac: "⌘⇧W",
          other: "Ctrl+Shift+Q",
        },
        { label: "Find in Terminal", mac: "⌘F", other: "Ctrl+Shift+F" },
        { label: "Find Next", mac: "⌘G", other: "—" },
        { label: "Find Previous", mac: "⌘⇧G", other: "—" },
        {
          label: "Clear Scrollback",
          mac: "⌘K",
          other: "Ctrl+Shift+K",
        },
        { label: "Rename Surface/Tab", mac: "⌘R", other: "—" },
        { label: "Rename Workspace", mac: "⌘⇧R", other: "Ctrl+Shift+R" },
      ],
    },
    {
      title: "App",
      rows: [
        {
          label: "Command Palette",
          mac: "⌘P",
          other: "Ctrl+Shift+P",
        },
        {
          label: "Switch Workspace (fuzzy)",
          mac: "⌘O",
          other: "Ctrl+O",
        },
        { label: "Keyboard Shortcuts", mac: "⌘/", other: "—" },
        {
          label: "Toggle Sidebar",
          mac: "⌘B",
          other: "Ctrl+Shift+B",
        },
        { label: "Settings", mac: "⌘,", other: "Ctrl+," },
        {
          label: "Jump to Unread",
          mac: "⌘⇧U",
          other: "Ctrl+Shift+U",
        },
      ],
    },
  ];
</script>

<div
  data-testid="shortcut-reference"
  style="
    flex: 1; min-width: 0; min-height: 0;
    display: flex; flex-direction: column;
    background: {$theme.bg}; color: {$theme.fg};
    overflow: auto;
  "
>
  <div
    style="
      display: flex; flex-direction: column; gap: 14px;
      padding: 24px 28px; max-width: 880px; width: 100%;
    "
  >
    <h2
      style="margin: 0; color: {$theme.fg}; font-size: 18px; font-weight: 600;"
    >
      Keyboard Shortcuts
    </h2>

    <div style="display: grid; gap: 22px;">
      {#each sections as section (section.title)}
        <section>
          <h3
            style="
              margin: 0 0 8px; color: {$theme.fgMuted}; font-size: 12px;
              text-transform: uppercase; letter-spacing: 0.06em;
            "
          >
            {section.title}
          </h3>
          <div
            style="
              display: grid;
              grid-template-columns: minmax(0, 1fr) minmax(120px, max-content) minmax(120px, max-content);
              gap: 4px 16px; align-items: baseline;
            "
          >
            <span
              style="font-size: 11px; color: {$theme.fgMuted}; text-transform: uppercase; letter-spacing: 0.05em;"
            >
              Action
            </span>
            <span
              style="font-size: 11px; color: {$theme.fgMuted}; text-transform: uppercase; letter-spacing: 0.05em;"
            >
              macOS
            </span>
            <span
              style="font-size: 11px; color: {$theme.fgMuted}; text-transform: uppercase; letter-spacing: 0.05em;"
            >
              Linux/Win
            </span>
            {#each section.rows as row (row.label)}
              <span style="color: {$theme.fg}; font-size: 13px;">
                {row.label}
              </span>
              <code
                style="
                  color: {$theme.fg}; font-size: 12px;
                  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                "
              >
                {row.mac}
              </code>
              <code
                style="
                  color: {row.other === '—' ? $theme.fgMuted : $theme.fg};
                  font-size: 12px;
                  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                "
              >
                {row.other}
              </code>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </div>
</div>
