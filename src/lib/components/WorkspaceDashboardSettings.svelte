<script lang="ts">
  /**
   * Settings panel for a Workspace's Dashboard. Mirrors the
   * GlobalAgenticDashboardBody Settings section so users have one
   * consistent "dashboard → Settings" mental model:
   *
   *   - Name field — persists `name`
   *   - Banner color picker — writes `color` on the workspace
   *   - Dashboards toggles — enable/disable each registered contribution
   *     for this workspace (autoProvision contribs render locked-on)
   *   - Markdown source — read-only path to the Overview preview file
   */
  import { theme } from "../stores/theme";
  import ColorSlotPicker from "./ColorSlotPicker.svelte";
  import { workspacesStore } from "../stores/workspaces";
  import {
    workspaceDashboardPath,
    updateWorkspace,
    closeDashboardForWorkspace,
  } from "../services/workspace-service";
  import { nestedWorkspaces } from "../stores/nested-workspace";
  import {
    dashboardContributionStore,
    type DashboardContribution,
  } from "../services/dashboard-contribution-registry";
  import { showConfirmPrompt } from "../stores/ui";
  import type { Component } from "svelte";
  import GridIcon from "../icons/GridIcon.svelte";
  import { wsMeta } from "../services/service-helpers";

  export let parentWorkspaceId: string;

  /** Per-row regenerate-in-flight flag. Keyed by contribution id. */
  let regeneratingRow: string | null = null;
  let regenerateError = "";

  $: workspace = $workspacesStore.find((w) => w.id === parentWorkspaceId);
  $: currentColorSlot = workspace?.color ?? "purple";
  $: markdownPath = workspace ? workspaceDashboardPath(workspace.path) : "";

  let nameDraft = "";
  let editingName = false;
  $: if (!editingName && workspace) nameDraft = workspace.name;

  function selectColor(slot: string): void {
    if (!workspace) return;
    updateWorkspace(workspace.id, { color: slot });
  }

  function commitName(): void {
    editingName = false;
    if (!workspace) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === workspace.name) return;
    updateWorkspace(workspace.id, { name: trimmed });
  }

  // The Dashboards section excludes the Settings contribution itself —
  // the user is already inside that dashboard and can't disable it.
  // Every other registered contribution gets a row. autoProvision rows
  // are rendered locked-on (toggle disabled + `lockedReason` tooltip);
  // the rest toggle based on workspace presence.
  $: dashboardRows = $dashboardContributionStore.filter(
    (c) => c.id !== "settings",
  );

  // Precompute the set of active contribution ids for this workspace as
  // a reactive derivation. `{@const active = activeIds.has(c.id)}` in
  // the template picks up changes to `$nestedWorkspaces` immediately —
  // calling a helper that reads `$nestedWorkspaces` internally does NOT
  // re-run on store updates in Svelte 5 (only the direct reference does).
  $: activeContributionIds = new Set<string>(
    workspace
      ? $nestedWorkspaces
          .filter((w) => {
            const md = wsMeta(w);
            return (
              md.isDashboard === true && md.parentWorkspaceId === workspace!.id
            );
          })
          .map((w) => wsMeta(w).dashboardContributionId)
          .filter((v): v is string => typeof v === "string")
      : [],
  );

  async function toggleDashboard(
    contribution: DashboardContribution,
    next: boolean,
  ): Promise<void> {
    if (!workspace) return;
    if (contribution.autoProvision) return;
    if (next) {
      try {
        await contribution.create(workspace);
      } catch (err) {
        console.error(
          `[workspace-settings] Failed to add "${contribution.id}":`,
          err,
        );
      }
    } else {
      closeDashboardForWorkspace(workspace.id, contribution.id);
    }
  }

  /**
   * Force-rewrite a dashboard's backing markdown from its current
   * seeded template. Surfaced per-row in the Dashboards section for
   * contributions that ship a `regenerate` callback. The dashboard's
   * preview surface watches its file and reloads automatically — no
   * workspace recreation needed. Confirmation gate is mandatory
   * because user edits to the markdown are overwritten.
   */
  async function regenerateDashboard(
    contribution: DashboardContribution,
  ): Promise<void> {
    if (!workspace) return;
    if (!contribution.regenerate) return;
    const confirmed = await showConfirmPrompt(
      `Delete and regenerate the "${contribution.label}" dashboard for "${workspace.name}"? Any custom edits to its markdown will be lost.`,
      {
        title: `Regenerate ${contribution.label}`,
        confirmLabel: "Regenerate",
        cancelLabel: "Cancel",
      },
    );
    if (!confirmed) return;
    regeneratingRow = contribution.id;
    regenerateError = "";
    try {
      await contribution.regenerate(workspace);
    } catch (err) {
      regenerateError = `Failed to regenerate "${contribution.label}": ${err instanceof Error ? err.message : String(err)}`;
      console.error(
        `[workspace-settings] regenerate("${contribution.id}") failed:`,
        err,
      );
    } finally {
      regeneratingRow = null;
    }
  }
</script>

{#if workspace}
  <div
    data-workspace-dashboard-settings
    data-workspace-id={workspace.id}
    style="
      flex: 1; min-width: 0; min-height: 0; overflow: auto;
      padding: 24px 32px; display: flex; flex-direction: column; gap: 24px;
      background: {$theme.bg}; color: {$theme.fg};
    "
  >
    <section style="display: flex; flex-direction: column; gap: 8px;">
      <h3 style="margin: 0; font-size: 14px; font-weight: 600;">Name</h3>
      <input
        data-workspace-name-input
        type="text"
        bind:value={nameDraft}
        on:focus={() => (editingName = true)}
        on:blur={commitName}
        on:keydown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          if (e.key === "Escape") {
            nameDraft = workspace?.name ?? "";
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
        Pick a color for this workspace's sidebar banner and rail.
      </p>
      <ColorSlotPicker currentSlot={currentColorSlot} onSelect={selectColor} />
    </section>

    <section
      data-dashboards-section
      style="display: flex; flex-direction: column; gap: 8px;"
    >
      <h3 style="margin: 0; font-size: 14px; font-weight: 600;">Dashboards</h3>
      <p style="margin: 0; color: {$theme.fgDim}; font-size: 12px;">
        Toggle which dashboards appear on this workspace. Required dashboards
        are always on.
      </p>
      <div
        style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;"
      >
        {#each dashboardRows as contribution (contribution.id)}
          {@const active = activeContributionIds.has(contribution.id)}
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
            {#if contribution.regenerate && (active || locked)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <button
                data-dashboard-regenerate={contribution.id}
                type="button"
                on:click|preventDefault|stopPropagation={() =>
                  void regenerateDashboard(contribution)}
                disabled={regeneratingRow === contribution.id}
                title={`Delete and regenerate "${contribution.label}" from its current template`}
                style="
                  background: transparent; color: {$theme.fgDim};
                  border: 1px solid {$theme.border}; border-radius: 3px;
                  padding: 2px 8px; font-size: 11px;
                  cursor: {regeneratingRow === contribution.id
                  ? 'wait'
                  : 'pointer'};
                  opacity: {regeneratingRow === contribution.id ? 0.6 : 1};
                "
              >
                {regeneratingRow === contribution.id
                  ? "Regenerating..."
                  : "Regenerate"}
              </button>
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
        {#if regenerateError}
          <div
            data-dashboards-regenerate-error
            style="color: {$theme.danger}; font-size: 11px; padding: 4px 0;"
          >
            {regenerateError}
          </div>
        {/if}
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
