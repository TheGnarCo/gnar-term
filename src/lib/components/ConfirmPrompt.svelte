<script lang="ts">
  import { tick } from "svelte";
  import { theme } from "../stores/theme";
  import { confirmPrompt } from "../stores/ui";

  let confirmBtn: HTMLButtonElement;

  function confirm() {
    if (!$confirmPrompt) return;
    $confirmPrompt.resolve(true);
    confirmPrompt.set(null);
  }

  function cancel() {
    if (!$confirmPrompt) return;
    $confirmPrompt.resolve(false);
    confirmPrompt.set(null);
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  $: if ($confirmPrompt) {
    void tick().then(() => {
      confirmBtn?.focus();
    });
  }
</script>

{#if $confirmPrompt}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    style="
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(0,0,0,0.5); display: flex;
      justify-content: center; padding-top: 120px;
    "
    on:mousedown|self={cancel}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      role="dialog"
      aria-modal="true"
      aria-label={$confirmPrompt.title ?? "Confirm"}
      tabindex="-1"
      style="
        width: 460px; height: fit-content; background: {$theme.bgFloat};
        border: 1px solid {$theme.border}; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        padding: 16px; display: flex; flex-direction: column; gap: 12px;
      "
      on:keydown={handleKeydown}
    >
      {#if $confirmPrompt.title}
        <div style="font-size: 14px; font-weight: 600; color: {$theme.fg};">
          {$confirmPrompt.title}
        </div>
      {/if}
      <div style="font-size: 13px; color: {$theme.fgMuted}; line-height: 1.5;">
        {$confirmPrompt.message}
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button
          on:click={cancel}
          style="
            padding: 6px 16px; border-radius: 6px; border: 1px solid {$theme.border};
            background: transparent; color: {$theme.fgMuted}; cursor: pointer; font-size: 13px;
          ">{$confirmPrompt.cancelLabel}</button
        >
        <button
          bind:this={confirmBtn}
          on:click={confirm}
          style="
            padding: 6px 16px; border-radius: 6px; border: none;
            background: {$confirmPrompt.danger ? $theme.danger : $theme.accent};
            color: white; cursor: pointer; font-size: 13px;
          ">{$confirmPrompt.confirmLabel}</button
        >
      </div>
    </div>
  </div>
{/if}
