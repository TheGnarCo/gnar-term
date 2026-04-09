<script lang="ts">
  import { theme } from "../stores/theme";
  import { getSettings } from "../settings";

  export let onNewSurface: () => void;
  export let onNewHarnessSurface: ((presetId: string) => void) | undefined =
    undefined;
  export let onClosePane: () => void;

  function handleNewHarness() {
    const settings = getSettings();
    const presetId =
      settings.defaultHarness || settings.harnesses[0]?.id || "claude";
    onNewHarnessSurface?.(presetId);
  }
</script>

<div
  data-empty-pane-placeholder
  style="
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 16px;
    background: {$theme.bg}; color: {$theme.fgMuted};
    min-height: 0; min-width: 0;
  "
>
  <div style="font-size: 13px; color: {$theme.fgDim};">This pane is empty</div>
  <div style="display: flex; gap: 8px;">
    <button
      data-new-terminal-btn
      class="action-btn"
      style="
        padding: 8px 16px; border-radius: 6px; cursor: pointer;
        background: {$theme.accent}; color: white; border: none;
        font-size: 13px; font-weight: 500;
      "
      on:click={onNewSurface}>New Terminal</button
    >
    {#if onNewHarnessSurface}
      <button
        data-new-harness-btn
        class="action-btn"
        style="
          padding: 8px 16px; border-radius: 6px; cursor: pointer;
          background: transparent; color: {$theme.accent};
          border: 1px solid {$theme.accent};
          font-size: 13px; font-weight: 500;
        "
        on:click={handleNewHarness}>New Harness</button
      >
    {/if}
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    style="font-size: 11px; color: {$theme.fgDim}; cursor: pointer; margin-top: 4px;"
    on:click={onClosePane}>Close pane</span
  >
</div>

<style>
  .action-btn:hover {
    filter: brightness(1.1);
  }
</style>
