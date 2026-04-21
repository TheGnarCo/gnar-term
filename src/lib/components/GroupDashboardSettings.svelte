<script lang="ts">
  /**
   * Settings panel for a Workspace Group's Dashboard. Mirrors the
   * GlobalAgenticDashboardBody Settings section so users have one
   * consistent "dashboard → Settings" mental model:
   *
   *   - Name field — persists `name`
   *   - Banner color picker — writes `color` on the group
   *   - Dashboards toggles — enable/disable each registered contribution
   *     for this group (autoProvision contribs render locked-on)
   *   - Markdown source — read-only path to the Overview preview file
   */
  import { theme } from "../stores/theme";
  import { PROJECT_COLOR_SLOTS, resolveProjectColor } from "../theme-data";
  import { workspaceGroupsStore } from "../stores/workspace-groups";
  import {
    groupDashboardPath,
    updateWorkspaceGroup,
    closeDashboardForGroup,
  } from "../services/workspace-group-service";
  import { workspaces } from "../stores/workspace";
  import {
    dashboardContributionStore,
    type DashboardContribution,
  } from "../services/dashboard-contribution-registry";
  import type { Component } from "svelte";
  import GridIcon from "../icons/GridIcon.svelte";

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

  // The Dashboards section excludes the Settings contribution itself —
  // the user is already inside that dashboard and can't disable it.
  // Every other registered contribution gets a row. autoProvision rows
  // are rendered locked-on (toggle disabled + `lockedReason` tooltip);
  // the rest toggle based on workspace presence.
  $: dashboardRows = $dashboardContributionStore.filter(
    (c) => c.id !== "settings",
  );

  function isActive(contribution: DashboardContribution): boolean {
    if (!group) return false;
    return $workspaces.some((w) => {
      const md = w.metadata as Record<string, unknown> | undefined;
      return (
        md?.isDashboard === true &&
        md?.groupId === group!.id &&
        md?.dashboardContributionId === contribution.id
      );
    });
  }

  async function toggleDashboard(
    contribution: DashboardContribution,
    next: boolean,
  ): Promise<void> {
    if (!group) return;
    if (contribution.autoProvision) return;
    if (next) {
      try {
        await contribution.create(group);
      } catch (err) {
        console.error(
          `[group-settings] Failed to add "${contribution.id}":`,
          err,
        );
      }
    } else {
      closeDashboardForGroup(group.id, contribution.id);
    }
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

    <section
      data-dashboards-section
      style="display: flex; flex-direction: column; gap: 8px;"
    >
      <h3 style="margin: 0; font-size: 14px; font-weight: 600;">Dashboards</h3>
      <p style="margin: 0; color: {$theme.fgDim}; font-size: 12px;">
        Toggle which dashboards appear on this workspace group. Required
        dashboards are always on.
      </p>
      <div
        style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;"
      >
        {#each dashboardRows as contribution (contribution.id)}
          {@const active = isActive(contribution)}
          {@const locked = contribution.autoProvision === true}
          {@const IconComp = (contribution.icon ?? GridIcon) as Component}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <label
            data-dashboard-toggle-row={contribution.id}
            data-locked={locked ? "true" : undefined}
            data-active={active ? "true" : undefined}
            title={locked ? (contribution.lockedReason ?? "Required") : ""}
            style="
              display: flex; align-items: center; gap: 10px;
              padding: 8px 10px;
              background: {$theme.bgSurface};
              border: 1px solid {$theme.border};
              border-radius: 6px;
              cursor: {locked ? 'not-allowed' : 'pointer'};
              opacity: {locked ? 0.7 : 1};
              max-width: 480px;
            "
          >
            <span
              aria-hidden="true"
              style="flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: {$theme.fgMuted ??
                $theme.fgDim};"
            >
              <svelte:component
                this={IconComp}
                size={14}
                color="currentColor"
              />
            </span>
            <span
              style="flex: 1; min-width: 0; font-size: 13px; font-weight: 500;"
              >{contribution.label}</span
            >
            {#if locked}
              <span
                data-dashboard-toggle-locked
                style="font-size: 11px; color: {$theme.fgDim};"
                >{contribution.lockedReason ?? "Required"}</span
              >
            {/if}
            <input
              data-dashboard-toggle-input
              type="checkbox"
              disabled={locked}
              checked={active || locked}
              on:change={(e) => {
                const checked = (e.currentTarget as HTMLInputElement).checked;
                void toggleDashboard(contribution, checked);
              }}
            />
          </label>
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
