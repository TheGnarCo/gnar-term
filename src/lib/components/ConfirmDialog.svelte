<script lang="ts">
  import { theme } from "../stores/theme";
  import { confirmDialog } from "../stores/dialog-service";

  function handleConfirm() {
    $confirmDialog?.resolve(true);
    confirmDialog.set(null);
  }

  function handleCancel() {
    $confirmDialog?.resolve(false);
    confirmDialog.set(null);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!$confirmDialog) return;
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  }
</script>

{#if $confirmDialog}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    style="
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.5); display: flex;
      justify-content: center; padding-top: 120px;
    "
    on:mousedown|self={handleCancel}
    on:keydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      style="
        width: 380px; height: fit-content;
        background: {$theme.bgFloat};
        border: 1px solid {$theme.border}; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        padding: 20px; display: flex; flex-direction: column; gap: 16px;
      "
      tabindex="-1"
    >
      {#if $confirmDialog.title}
        <div style="font-size: 15px; font-weight: 600; color: {$theme.fg};">
          {$confirmDialog.title}
        </div>
      {/if}

      <div style="font-size: 13px; color: {$theme.fgMuted}; line-height: 1.5;">
        {$confirmDialog.message}
      </div>

      <div
        style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;"
      >
        <button
          on:click={handleCancel}
          style="
            padding: 6px 16px; border-radius: 6px; border: 1px solid {$theme.border};
            background: transparent; color: {$theme.fgMuted}; cursor: pointer; font-size: 13px;
          ">Cancel</button
        >
        <button
          on:click={handleConfirm}
          style="
            padding: 6px 16px; border-radius: 6px; border: none;
            background: {$confirmDialog.danger
            ? $theme.danger
            : $theme.accent}; color: white;
            cursor: pointer; font-size: 13px;
          ">{$confirmDialog.confirmLabel || "OK"}</button
        >
      </div>
    </div>
  </div>
{/if}
