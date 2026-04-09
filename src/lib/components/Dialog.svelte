<script lang="ts">
  import { theme } from "../stores/theme";

  export let visible: boolean;
  export let title: string;
  export let width: string = "480px";
  export let paddingTop: string = "100px";
  export let onCancel: () => void;
  export let onSubmit: () => void;
  export let submitLabel: string = "OK";
  export let onKeydown: ((e: KeyboardEvent) => void) | undefined = undefined;

  function handleKeydown(e: KeyboardEvent) {
    if (onKeydown) {
      onKeydown(e);
      return;
    }
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    style="
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.5); display: flex;
      justify-content: center; padding-top: {paddingTop};
    "
    on:mousedown|self={onCancel}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      style="
        width: {width}; max-height: 80vh; height: fit-content;
        background: {$theme.bgFloat}; --dialog-focus-color: {$theme.borderActive};
        border: 1px solid {$theme.border}; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        padding: 20px; display: flex; flex-direction: column; gap: 16px;
        overflow-y: auto;
      "
      on:keydown={handleKeydown}
    >
      <div style="font-size: 15px; font-weight: 600; color: {$theme.fg};">
        {title}
      </div>

      <slot />

      <div
        style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;"
      >
        <button
          on:click={onCancel}
          style="
            padding: 6px 16px; border-radius: 6px; border: 1px solid {$theme.border};
            background: transparent; color: {$theme.fgMuted}; cursor: pointer; font-size: 13px;
          ">Cancel</button
        >
        <button
          on:click={onSubmit}
          style="
            padding: 6px 16px; border-radius: 6px; border: none;
            background: {$theme.accent}; color: white; cursor: pointer; font-size: 13px;
          ">{submitLabel}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  :global(input:focus),
  :global(select:focus) {
    border-color: var(--dialog-focus-color, #7aa2f7) !important;
  }
</style>
