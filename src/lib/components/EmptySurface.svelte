<script lang="ts">
  /**
   * EmptySurface — shown in the terminal area when `$workspaces` is
   * empty (the user has closed every workspace). Provides generic
   * buttons to reopen the app into a useful state without needing to
   * know the command palette.
   *
   * Buttons are sourced from:
   *   - `workspaceActionStore` (core + extension non-sidebar actions
   *     whose `when` filter accepts an empty context)
   *   - `commandStore` entries registered with the ids listed in
   *     `empty-surface-commands.ts` (e.g. project-scope:create-project)
   */
  import { theme } from "../stores/theme";
  import { workspaceActionStore } from "../services/workspace-action-registry";
  import { commandStore } from "../services/command-registry";
  import { EMPTY_SURFACE_COMMAND_IDS } from "../services/empty-surface-commands";

  const iconSvgMap: Record<string, string> = {
    plus: `<line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />`,
    "git-branch": `<line x1="7" y1="2" x2="7" y2="10" /><line x1="3" y1="6" x2="11" y2="6" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><path d="M7 10 C7 12 10 12 12 12" fill="none" />`,
    "folder-plus": `<path d="M2 4 L2 13 L14 13 L14 6 L8 6 L7 4 Z" fill="none" /><line x1="8" y1="8" x2="8" y2="12" /><line x1="6" y1="10" x2="10" y2="10" />`,
  };

  $: workspaceActions = $workspaceActionStore.filter(
    (a) => a.zone !== "sidebar" && (!a.when || a.when({})),
  );

  // Commands to promote as buttons. Filter to those actually registered.
  $: promotedCommands = EMPTY_SURFACE_COMMAND_IDS.map((id) =>
    $commandStore.find((c) => c.id === id),
  ).filter((c): c is NonNullable<typeof c> => !!c);

  interface Button {
    label: string;
    icon: string;
    run: () => void;
  }

  $: buttons = [
    ...workspaceActions.map(
      (a): Button => ({
        label: a.label,
        icon: a.icon,
        run: () => void a.handler({}),
      }),
    ),
    ...promotedCommands.map(
      (c): Button => ({
        label: c.title.replace(/\.\.\.$/, ""),
        icon: "folder-plus",
        run: () => void c.action(),
      }),
    ),
  ];
</script>

<div
  style="
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: {$theme.bg};
    overflow: auto;
  "
>
  <div
    style="
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 32px;
      max-width: 520px;
    "
  >
    <div
      style="
        font-size: 13px;
        color: {$theme.fgMuted};
        text-align: center;
        line-height: 1.5;
      "
    >
      No workspaces are open. Create one to get started.
    </div>
    {#if buttons.length > 0}
      <div
        style="
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
        "
      >
        {#each buttons as btn (btn.label)}
          <button
            type="button"
            on:click={btn.run}
            style="
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 8px 14px;
              border: 1px solid {$theme.border};
              background: {$theme.bgSurface};
              color: {$theme.fg};
              border-radius: 6px;
              font-size: 13px;
              font-family: inherit;
              cursor: pointer;
              transition: background 0.1s, border-color 0.1s;
            "
            on:mouseenter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                $theme.borderActive ?? $theme.accent;
            }}
            on:mouseleave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                $theme.border;
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              {@html iconSvgMap[btn.icon] ?? iconSvgMap.plus}
            </svg>
            {btn.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
