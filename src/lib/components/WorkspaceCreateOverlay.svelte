<script lang="ts">
  import { tick } from "svelte";
  import type { Readable } from "svelte/store";
  import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
  import ColorPicker from "./ColorPicker.svelte";
  import { theme } from "../stores/theme";
  import { WORKSPACE_COLOR_SLOTS, resolveWorkspaceColor } from "../theme-data";
  import {
    pendingCreateResolver,
    createDialogPrefill,
    type CreateDialogResult,
  } from "../stores/workspaces-ui";

  // ColorPicker types theme as Readable<Record<string, string>>; the
  // core store is Readable<ThemeDef>, structurally compatible but not
  // assignable without a cast.
  const themeView = theme as unknown as Readable<Record<string, string>>;

  const colorLabelId = `wg-color-label-${Math.random().toString(36).slice(2)}`;

  function randomColor(): string {
    return (
      WORKSPACE_COLOR_SLOTS[
        Math.floor(Math.random() * WORKSPACE_COLOR_SLOTS.length)
      ] ?? "#4a90e2"
    );
  }

  let name = "";
  let path = "";
  let color: string = randomColor();
  let error = "";
  let nameManuallyEdited = false;
  let nameInput: HTMLInputElement;

  let showDialog = false;

  $: {
    // Mount/unmount based on resolver presence. The dialog reads the
    // current prefill each time it opens so reopening after a cancel
    // picks up fresh defaults.
    const hasResolver = $pendingCreateResolver !== null;
    if (hasResolver && !showDialog) {
      const prefill = $createDialogPrefill;
      name = prefill?.name ?? "";
      path = prefill?.path ?? "";
      color = randomColor();
      error = "";
      // If we got a name from prefill, treat it as manually-edited so
      // browsing later doesn't clobber it with the derived basename.
      nameManuallyEdited = Boolean(prefill?.name);
      showDialog = true;
      void tick().then(() => nameInput?.focus());
    } else if (!hasResolver && showDialog) {
      showDialog = false;
    }
  }

  async function browse() {
    const selected = await dialogOpen({
      directory: true,
      title: "Select Workspace Folder",
    });
    if (typeof selected !== "string") return;
    path = selected;
    if (!nameManuallyEdited || !name) {
      const parts = selected.replace(/\/+$/, "").split("/");
      name = parts[parts.length - 1] || "";
      nameManuallyEdited = false;
    }
  }

  function handleNameInput() {
    nameManuallyEdited = true;
  }

  function resolveWith(value: CreateDialogResult) {
    const resolver = $pendingCreateResolver;
    if (resolver) resolver(value);
    createDialogPrefill.set(null);
  }

  function submit() {
    if (!path) {
      error = "Please select a workspace folder.";
      return;
    }
    if (!name.trim()) {
      error = "Please enter a name.";
      return;
    }
    resolveWith({ name: name.trim(), path, color: color ?? "" });
  }

  function cancel() {
    resolveWith(null);
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
</script>

{#if showDialog}
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
        width: 480px; height: fit-content; background: {$theme.bgFloat};
        border: 1px solid {$theme.border}; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        padding: 20px; display: flex; flex-direction: column; gap: 14px;
      "
      on:keydown={handleKeydown}
    >
      <div style="font-size: 14px; font-weight: 600; color: {$theme.fg};">
        New Workspace
      </div>

      {#if error}
        <div
          style="
            padding: 8px 12px; border-radius: 6px;
            background: rgba(255,60,60,0.1); border: 1px solid {$theme.danger};
            color: {$theme.danger}; font-size: 12px;
          "
        >
          {error}
        </div>
      {/if}

      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label
          for="workspace-folder"
          style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
          >Folder</label
        >
        <div style="display: flex; gap: 8px;">
          <input
            id="workspace-folder"
            type="text"
            readonly
            value={path}
            placeholder="No folder selected"
            class="no-default-outline"
            style="
              flex: 1; padding: 8px 12px; background: {$theme.bg};
              border: 1px solid {$theme.borderActive}; border-radius: 6px;
              color: {path ? $theme.fg : $theme.fgDim}; font-size: 13px;
              font-family: inherit; box-sizing: border-box; cursor: default;
            "
          />
          <button
            on:click={browse}
            style="
              padding: 8px 14px; border-radius: 6px;
              border: 1px solid {$theme.border};
              background: {$theme.bgHighlight}; color: {$theme.fg};
              cursor: pointer; font-size: 13px; white-space: nowrap;
            ">Browse...</button
          >
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label
          for="workspace-name"
          style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
          >Name</label
        >
        <input
          id="workspace-name"
          bind:this={nameInput}
          type="text"
          bind:value={name}
          on:input={handleNameInput}
          placeholder="my-workspace"
          class="no-default-outline"
          style="
            padding: 8px 12px; background: {$theme.bg};
            border: 1px solid {$theme.borderActive}; border-radius: 6px;
            color: {$theme.fg}; font-size: 13px;
            font-family: inherit; width: 100%; box-sizing: border-box;
          "
        />
      </div>

      <div style="display: flex; flex-direction: column; gap: 4px;">
        <span
          id={colorLabelId}
          style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
          >Color</span
        >
        <div aria-labelledby={colorLabelId} role="radiogroup">
          <ColorPicker
            bind:value={color}
            colors={[...WORKSPACE_COLOR_SLOTS]}
            resolveColor={(c: string) => resolveWorkspaceColor(c, $theme)}
            theme={themeView}
          />
        </div>
      </div>

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
