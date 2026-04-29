<script lang="ts">
  import { tick } from "svelte";
  import { theme } from "../stores/theme";
  import { inputPrompt } from "../stores/ui";

  let inputEl: HTMLInputElement;
  let cancelBtn: HTMLButtonElement;
  let okBtn: HTMLButtonElement;

  function submit() {
    if (!$inputPrompt) return;
    const value = inputEl?.value?.trim() || null;
    $inputPrompt.resolve(value);
    inputPrompt.set(null);
  }

  function cancel() {
    if (!$inputPrompt) return;
    $inputPrompt.resolve(null);
    inputPrompt.set(null);
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    // Focus trap: cycle Tab/Shift+Tab among input, cancel, ok
    if (e.key === "Tab") {
      const focusables = [inputEl, cancelBtn, okBtn].filter(Boolean);
      const current = document.activeElement;
      const idx = focusables.indexOf(current as HTMLInputElement);
      if (e.shiftKey) {
        e.preventDefault();
        const prev = idx <= 0 ? focusables.length - 1 : idx - 1;
        focusables[prev]?.focus();
      } else {
        e.preventDefault();
        const next = idx >= focusables.length - 1 ? 0 : idx + 1;
        focusables[next]?.focus();
      }
    }
  }

  $: if ($inputPrompt) {
    void tick().then(() => {
      inputEl?.focus();
      inputEl?.select();
    });
  }
</script>

{#if $inputPrompt}
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={$inputPrompt.placeholder}
      tabindex="-1"
      style="
        width: 460px; height: fit-content; background: {$theme.bgFloat};
        border: 1px solid {$theme.border}; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        padding: 16px; display: flex; flex-direction: column; gap: 12px;
      "
      on:keydown={handleKeydown}
    >
      <input
        bind:this={inputEl}
        type="text"
        placeholder={$inputPrompt.placeholder}
        aria-label={$inputPrompt.placeholder}
        value={$inputPrompt.defaultValue || ""}
        style="
          padding: 10px 14px; background: {$theme.bg}; border: 1px solid {$theme.borderActive};
          border-radius: 8px; color: {$theme.fg}; font-size: 14px;
          outline: none; font-family: inherit; width: 100%; box-sizing: border-box;
        "
      />
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button
          bind:this={cancelBtn}
          on:click={cancel}
          style="
            padding: 6px 16px; border-radius: 6px; border: 1px solid {$theme.border};
            background: transparent; color: {$theme.fgMuted}; cursor: pointer; font-size: 13px;
          ">Cancel</button
        >
        <button
          bind:this={okBtn}
          on:click={submit}
          style="
            padding: 6px 16px; border-radius: 6px; border: none;
            background: {$theme.accent}; color: white; cursor: pointer; font-size: 13px;
          ">OK</button
        >
      </div>
    </div>
  </div>
{/if}
