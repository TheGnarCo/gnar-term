<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import type { Readable } from "svelte/store";
  import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
  import { theme } from "../stores/theme";
  import { formPrompt } from "../stores/ui";
  import ColorPicker from "./ColorPicker.svelte";
  import { GROUP_COLOR_SLOTS, resolveWorkspaceColor } from "../theme-data";

  // ColorPicker's prop shape keys the theme as a flat record; the core
  // theme store is Readable<ThemeDef>, which is structurally compatible
  // but not assignable without a cast. Re-view it here so Svelte's type
  // checker accepts the binding.
  const themeView = theme as unknown as Readable<Record<string, string>>;

  let values: Record<string, string> = {};
  let firstInput: HTMLInputElement | null = null;
  let validationError = "";

  function captureFirst(node: HTMLInputElement, isFirst: boolean) {
    if (isFirst) firstInput = node;
  }

  function submit() {
    if (!$formPrompt) return;
    // Directory fields marked required must resolve to a non-empty path
    // before we resolve the prompt. The inline error mirrors the existing
    // $formPrompt.error slot so the caller's styling is preserved.
    for (const f of $formPrompt.fields) {
      if (
        f.type === "directory" &&
        f.required &&
        !(values[f.key] ?? "").trim()
      ) {
        validationError = `${f.label} is required.`;
        return;
      }
    }
    validationError = "";
    $formPrompt.resolve({ ...values });
    formPrompt.set(null);
    values = {};
  }

  function cancel() {
    if (!$formPrompt) return;
    $formPrompt.resolve(null);
    formPrompt.set(null);
    values = {};
    validationError = "";
  }

  async function browseDirectory(
    key: string,
    title: string | undefined,
  ): Promise<void> {
    try {
      const result = await dialogOpen({
        directory: true,
        title: title ?? "Select Directory",
      });
      if (typeof result === "string") {
        values = { ...values, [key]: result };
        validationError = "";
      }
    } catch {
      // Dialog plugin not registered or user platform error — keep the
      // dialog open so the user can cancel or try again instead of
      // closing silently.
    }
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

  // Intentionally not using a `$:` block here. A reactive statement that
  // iterates $formPrompt.fields mutating `values[f.key]` triggers
  // Svelte 5's auto-dependency tracker to spuriously pull in the `field`
  // identifier from the template's `{#each … as field}` scope, producing
  // a runtime ReferenceError (`field is not defined`) the moment the
  // component renders. A direct store subscription sidesteps that.
  const unsubscribePrompt = formPrompt.subscribe((prompt) => {
    if (!prompt) return;
    const next: Record<string, string> = {};
    for (const fld of prompt.fields) {
      next[fld.key] = fld.defaultValue ?? "";
    }
    values = next;
    void tick().then(() => firstInput?.focus());
  });
  onDestroy(unsubscribePrompt);
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="form-prompt-title"
      tabindex="-1"
      style="
        width: 460px; height: fit-content; background: {$theme.bgFloat};
        border: 1px solid {$theme.border}; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        padding: 20px; display: flex; flex-direction: column; gap: 14px;
      "
      on:keydown={handleKeydown}
    >
      <div
        id="form-prompt-title"
        style="font-size: 14px; font-weight: 600; color: {$theme.fg};"
      >
        {$formPrompt.title}
      </div>

      {#if $formPrompt.error || validationError}
        <div
          style="
            padding: 8px 12px; border-radius: 6px;
            background: rgba(255,60,60,0.1); border: 1px solid {$theme.danger};
            color: {$theme.danger}; font-size: 12px;
          "
        >
          {$formPrompt.error || validationError}
        </div>
      {/if}

      {#each $formPrompt.fields as field, fieldIdx}
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label
            for="form-{field.key}"
            style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
          >
            {field.label}
          </label>
          {#if field.type === "select"}
            <select
              id="form-{field.key}"
              bind:value={values[field.key]}
              style="
                padding: 8px 12px; background: {$theme.bg};
                border: 1px solid {$theme.borderActive}; border-radius: 6px;
                color: {$theme.fg}; font-size: 13px;
                outline: none; font-family: inherit; width: 100%;
                box-sizing: border-box;
              "
            >
              {#each field.options as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          {:else if field.type === "color"}
            <ColorPicker
              bind:value={values[field.key] as string}
              colors={[...GROUP_COLOR_SLOTS]}
              resolveColor={(c) => resolveWorkspaceColor(c, $theme)}
              theme={themeView}
            />
          {:else if field.type === "directory"}
            <div style="display: flex; gap: 8px;">
              <!-- Directly bound so typing or pasting a path works even
                   when the native dialog is unavailable. When the field
                   is locked (project-inherited), we flip to a read-only
                   view + suppress Browse. -->
              {#if field.readonly}
                <input
                  id="form-{field.key}"
                  type="text"
                  readonly
                  value={values[field.key] ?? ""}
                  placeholder={field.placeholder ?? "No folder selected"}
                  title={values[field.key]
                    ? `${values[field.key]} (locked)`
                    : undefined}
                  style="
                    flex: 1; padding: 8px 12px;
                    background: {$theme.bgSurface};
                    border: 1px solid {$theme.border}; border-radius: 6px;
                    color: {values[field.key] ? $theme.fg : $theme.fgDim};
                    opacity: 0.75;
                    font-size: 13px;
                    outline: none; font-family: inherit; box-sizing: border-box; cursor: default;
                  "
                />
              {:else}
                <input
                  id="form-{field.key}"
                  type="text"
                  bind:value={values[field.key]}
                  placeholder={field.placeholder ?? "No folder selected"}
                  style="
                    flex: 1; padding: 8px 12px; background: {$theme.bg};
                    border: 1px solid {$theme.borderActive}; border-radius: 6px;
                    color: {$theme.fg}; font-size: 13px;
                    outline: none; font-family: inherit; box-sizing: border-box;
                  "
                />
                <button
                  type="button"
                  on:click={() =>
                    browseDirectory(
                      field.key,
                      "pickerTitle" in field ? field.pickerTitle : undefined,
                    )}
                  style="
                    padding: 8px 14px; border-radius: 6px;
                    border: 1px solid {$theme.border};
                    background: {$theme.bgHighlight}; color: {$theme.fg};
                    cursor: pointer; font-size: 13px; white-space: nowrap;
                  ">Browse...</button
                >
              {/if}
            </div>
          {:else if field.type === "info"}
            <div
              style="
                padding: 8px 12px; background: {$theme.bg};
                border: 1px solid {$theme.border}; border-radius: 6px;
                color: {$theme.fgMuted}; font-size: 12px;
                word-break: break-all; font-family: ui-monospace, Menlo, monospace;
              "
            >
              {field.defaultValue ?? ""}
            </div>
          {:else}
            <input
              id="form-{field.key}"
              use:captureFirst={fieldIdx === 0}
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
          {/if}
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
          ">{$formPrompt.submitLabel ?? "Create"}</button
        >
      </div>
    </div>
  </div>
{/if}
