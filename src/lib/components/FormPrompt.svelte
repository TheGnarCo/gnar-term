<script lang="ts">
  import { tick } from "svelte";
  import { theme } from "../stores/theme";
  import { formPrompt } from "../stores/ui";

  let values: Record<string, string> = {};
  let firstInput: HTMLInputElement | null = null;

  function captureFirst(node: HTMLInputElement, isFirst: boolean) {
    if (isFirst) firstInput = node;
  }

  function submit() {
    if (!$formPrompt) return;
    $formPrompt.resolve({ ...values });
    formPrompt.set(null);
    values = {};
  }

  function cancel() {
    if (!$formPrompt) return;
    $formPrompt.resolve(null);
    formPrompt.set(null);
    values = {};
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  $: if ($formPrompt) {
    values = {};
    for (const f of $formPrompt.fields) {
      values[f.key] = f.defaultValue ?? "";
    }
    void tick().then(() => firstInput?.focus());
  }
</script>

{#if $formPrompt}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    style="
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(0,0,0,0.5); display: flex;
      justify-content: center; padding-top: 100px;
    "
    on:mousedown|self={cancel}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      style="
        width: 460px; height: fit-content; background: {$theme.bgFloat};
        border: 1px solid {$theme.border}; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        padding: 20px; display: flex; flex-direction: column; gap: 14px;
      "
      on:keydown={handleKeydown}
    >
      <div style="font-size: 14px; font-weight: 600; color: {$theme.fg};">
        {$formPrompt.title}
      </div>

      {#if $formPrompt.error}
        <div
          style="
            padding: 8px 12px; border-radius: 6px;
            background: rgba(255,60,60,0.1); border: 1px solid {$theme.danger};
            color: {$theme.danger}; font-size: 12px;
          "
        >
          {$formPrompt.error}
        </div>
      {/if}

      {#each $formPrompt.fields as field, i (field.key)}
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label
            for="form-{field.key}"
            style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
          >
            {field.label}
          </label>
          <input
            id="form-{field.key}"
            use:captureFirst={i === 0}
            type="text"
            placeholder={field.placeholder ?? ""}
            bind:value={values[field.key]}
            style="
              padding: 8px 12px; background: {$theme.bg};
              border: 1px solid {$theme.borderActive}; border-radius: 6px;
              color: {$theme.fg}; font-size: 13px;
              outline: none; font-family: inherit; width: 100%;
              box-sizing: border-box;
            "
          />
        </div>
      {/each}

      <div
        style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px;"
      >
        <button
          on:click={cancel}
          style="
            padding: 6px 16px; border-radius: 6px; border: 1px solid {$theme.border};
            background: transparent; color: {$theme.fgMuted}; cursor: pointer; font-size: 13px;
          ">Cancel</button
        >
        <button
          on:click={submit}
          style="
            padding: 6px 16px; border-radius: 6px; border: none;
            background: {$theme.accent}; color: white; cursor: pointer; font-size: 13px;
          ">Create</button
        >
      </div>
    </div>
  </div>
{/if}
