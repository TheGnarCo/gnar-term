<script lang="ts">
  /**
   * Settings panel for a Workspace Group's Dashboard. Mirrors the
   * GlobalAgenticDashboardBody Settings section so users have one
   * consistent "dashboard → Settings" mental model:
   *
   *   - Banner color picker — writes `color` on the group (sidebar
   *     banner + nested-row rail both read from it live).
   *   - Rename field — persists `name`.
   *   - Backing markdown path — surfaced read-only for discoverability
   *     so users know where the Overview tab reads from.
   */
  import { theme } from "../stores/theme";
  import { PROJECT_COLOR_SLOTS, resolveProjectColor } from "../theme-data";
  import { workspaceGroupsStore } from "../stores/workspace-groups";
  import { groupDashboardPath } from "../services/workspace-group-service";
  import { updateWorkspaceGroup } from "../services/workspace-group-service";

  export let groupId: string;

  $: group = $workspaceGroupsStore.find((g) => g.id === groupId);
  $: currentColorSlot = group?.color ?? "purple";
  $: markdownPath = group ? groupDashboardPath(group.path) : "";

  let nameDraft = "";
  let editingName = false;
  $: if (!editingName && group) nameDraft = group.name;

  function selectColor(slot: string): void {
    if (!group) return;
    updateWorkspaceGroup(group.id, { color: slot });
  }

  function commitName(): void {
    editingName = false;
    if (!group) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === group.name) return;
    updateWorkspaceGroup(group.id, { name: trimmed });
  }
</script>

{#if group}
  <div
    data-group-dashboard-settings
    data-group-id={group.id}
    style="
      flex: 1; min-width: 0; min-height: 0; overflow: auto;
      padding: 24px 32px; display: flex; flex-direction: column; gap: 24px;
      background: {$theme.bg}; color: {$theme.fg};
    "
  >
    <section style="display: flex; flex-direction: column; gap: 8px;">
      <h3 style="margin: 0; font-size: 14px; font-weight: 600;">Name</h3>
      <input
        data-group-name-input
        type="text"
        bind:value={nameDraft}
        on:focus={() => (editingName = true)}
        on:blur={commitName}
        on:keydown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          if (e.key === "Escape") {
            nameDraft = group?.name ?? "";
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        style="
          padding: 6px 10px;
          background: {$theme.bgSurface};
          color: {$theme.fg};
          border: 1px solid {$theme.border};
          border-radius: 4px; font-size: 13px;
          max-width: 420px;
        "
      />
    </section>

    <section style="display: flex; flex-direction: column; gap: 8px;">
      <h3 style="margin: 0; font-size: 14px; font-weight: 600;">
        Banner color
      </h3>
      <p style="margin: 0; color: {$theme.fgDim}; font-size: 12px;">
        Pick a color for this group's sidebar banner and rail.
      </p>
      <div
        data-color-picker
        style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;"
      >
        {#each PROJECT_COLOR_SLOTS as slot (slot)}
          {@const hex = resolveProjectColor(slot, $theme)}
          {@const isSelected = slot === currentColorSlot}
          <button
            data-color-slot={slot}
            data-selected={isSelected ? "true" : undefined}
            title={slot}
            on:click={() => selectColor(slot)}
            style="
              width: 32px; height: 32px; border-radius: 6px;
              background: {hex};
              border: 2px solid {isSelected ? $theme.fg : 'transparent'};
              cursor: pointer;
              padding: 0;
            "
            aria-label={`Select ${slot}`}
          ></button>
        {/each}
      </div>
    </section>

    <section style="display: flex; flex-direction: column; gap: 4px;">
      <h3 style="margin: 0; font-size: 14px; font-weight: 600;">
        Markdown source
      </h3>
      <p style="margin: 0; color: {$theme.fgDim}; font-size: 12px;">
        Backing file for this dashboard's Overview tab.
      </p>
      <code
        data-markdown-path
        style="
          margin-top: 4px; padding: 6px 10px;
          background: {$theme.bgSurface}; border: 1px solid {$theme.border};
          border-radius: 4px; font-size: 12px;
        ">{markdownPath}</code
      >
    </section>
  </div>
{/if}
