<script lang="ts">
  import { tick, getContext, type Component } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import { PROJECT_COLORS } from "./index";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const { ColorPicker } = api.getComponents();

  let name = "";
  let path = "";
  let color = PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
  let error = "";
  let nameManuallyEdited = false;
  let nameInput: HTMLInputElement;

  // Dialog visibility is driven by custom event from createProjectFlow
  let showDialog = false;
  api.on("extension:project:dialog-toggle", (event) => {
    const e = event as Record<string, unknown>;
    showDialog = (e.visible as boolean) ?? false;
  });

  function reset() {
    name = "";
    path = "";
    color = PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
    error = "";
    nameManuallyEdited = false;
  }

  async function browse() {
    const selected = await api.pickDirectory("Select Project Root");
    if (!selected) return;
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

  function resolveDialog(
    value: { name: string; path: string; color: string } | null,
  ) {
    const resolve = api.state.get<((v: unknown) => void) | null>(
      "createDialogResolve",
    );
    if (resolve) {
      resolve(value);
      api.state.set("createDialogResolve", null);
    }
    api.state.set("showCreateDialog", false);
    showDialog = false;
    reset();
  }

  function submit() {
    if (!path) {
      error = "Please select a project folder.";
      return;
    }
    if (!name.trim()) {
      error = "Please enter a project name.";
      return;
    }
    resolveDialog({ name: name.trim(), path, color: color ?? "" });
  }

  function cancel() {
    resolveDialog(null);
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

  $: if (showDialog) {
    reset();
    void tick().then(() => nameInput?.focus());
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
        New Project
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
          for="project-folder"
          style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
          >Project Folder</label
        >
        <div style="display: flex; gap: 8px;">
          <input
            id="project-folder"
            type="text"
            readonly
            value={path}
            placeholder="No folder selected"
            style="
              flex: 1; padding: 8px 12px; background: {$theme.bg};
              border: 1px solid {$theme.borderActive}; border-radius: 6px;
              color: {path ? $theme.fg : $theme.fgDim}; font-size: 13px;
              outline: none; font-family: inherit; box-sizing: border-box; cursor: default;
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
          for="project-name"
          style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
          >Project Name</label
        >
        <input
          id="project-name"
          bind:this={nameInput}
          type="text"
          bind:value={name}
          on:input={handleNameInput}
          placeholder="my-project"
          style="
            padding: 8px 12px; background: {$theme.bg};
            border: 1px solid {$theme.borderActive}; border-radius: 6px;
            color: {$theme.fg}; font-size: 13px;
            outline: none; font-family: inherit; width: 100%; box-sizing: border-box;
          "
        />
      </div>

      <div style="display: flex; flex-direction: column; gap: 4px;">
        <span style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
          >Color</span
        >
        <svelte:component
          this={ColorPicker as Component}
          bind:value={color}
          colors={PROJECT_COLORS}
          {theme}
        />
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
