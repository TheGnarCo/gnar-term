<script lang="ts">
  import { theme } from "../stores/theme";

  /**
   * Modal reference for every keyboard shortcut wired into the app.
   * Bound to a parent flag so the host owns open/close. Closes on Escape
   * or backdrop click. macOS bindings use ⌘/⇧, Linux/Windows uses
   * Ctrl+/Shift+.
   */
  export let open = false;

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
          label: "Switch Branch 1-9",
          mac: "Ctrl+1-9",
          other: "Ctrl+1-9",
        },
        {
          label: "Next Branch",
          mac: "⌘⇧]",
          other: "Ctrl+Shift+]",
        },
        {
          label: "Prev Branch",
          mac: "⌘⇧[",
          other: "Ctrl+Shift+[",
        },
        {
          label: "Cycle Branch Forward",
          mac: "Ctrl+Tab",
          other: "Ctrl+Tab",
        },
        {
          label: "Cycle Branch Back",
          mac: "Ctrl+Shift+Tab",
          other: "Ctrl+Shift+Tab",
        },
        { label: "Focus Pane Left", mac: "Alt+⌘←", other: "—" },
        { label: "Focus Pane Right", mac: "Alt+⌘→", other: "—" },
        { label: "Focus Pane Up", mac: "Alt+⌘↑", other: "—" },
        { label: "Focus Pane Down", mac: "Alt+⌘↓", other: "—" },
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
          other: "—",
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
      ],
    },
    {
      title: "Surfaces (Terminals)",
      rows: [
        { label: "New Branch", mac: "⌘N", other: "—" },
        { label: "New Terminal", mac: "⌘T", other: "—" },
        { label: "Close Terminal", mac: "⌘W", other: "Ctrl+Shift+W" },
        {
          label: "Close Branch",
          mac: "⌘⇧W",
          other: "Ctrl+Shift+Q",
        },
        { label: "Find in Terminal", mac: "⌘F", other: "Ctrl+Shift+F" },
        {
          label: "Clear Scrollback",
          mac: "⌘K",
          other: "Ctrl+Shift+K",
        },
        { label: "Rename Terminal", mac: "⌘R", other: "—" },
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
          label: "Switch Branch (fuzzy)",
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

  function close(): void {
    open = false;
  }

  function handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-testid="shortcut-reference"
    style="
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(0,0,0,0.5); display: flex;
      justify-content: center; align-items: flex-start; padding-top: 60px;
    "
    on:mousedown|self={close}
    on:keydown={handleKeydown}
    tabindex="-1"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-reference-title"
      style="
        width: 720px; max-width: 90vw; max-height: 80vh;
        background: {$theme.bgFloat};
        border: 1px solid {$theme.border}; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        padding: 18px; display: flex; flex-direction: column; gap: 14px;
        overflow: hidden;
      "
    >
      <div
        style="display: flex; align-items: baseline; justify-content: space-between;"
      >
        <h2
          id="shortcut-reference-title"
          style="margin: 0; color: {$theme.fg}; font-size: 16px; font-weight: 600;"
        >
          Keyboard Shortcuts
        </h2>
        <button
          type="button"
          on:click={close}
          aria-label="Close"
          style="
            background: transparent; border: none; color: {$theme.fgMuted};
            font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1;
          "
        >
          ×
        </button>
      </div>

      <div style="overflow-y: auto; min-height: 0; display: grid; gap: 18px;">
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
{/if}
