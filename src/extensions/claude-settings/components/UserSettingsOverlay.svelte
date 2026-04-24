<script lang="ts">
  import { getContext, onMount } from "svelte";
  import type { Writable } from "svelte/store";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import SettingsFileEditor from "./SettingsFileEditor.svelte";

  export let visibleStore: Writable<boolean>;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const themeStore = api.theme;

  let homePath = "";
  $: settingsPath = homePath ? `${homePath}/.claude/settings.json` : "";

  onMount(async () => {
    homePath = await api.invoke<string>("get_home");
  });

  function close() {
    visibleStore.set(false);
  }

  function handleBackdrop(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("overlay-backdrop")) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

{#if $visibleStore}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="overlay-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Claude User Settings"
    on:click={handleBackdrop}
    on:keydown={handleKeydown}
    style="background: rgba(0,0,0,0.55);"
  >
    <div
      class="overlay-panel"
      style="background: {$themeStore.bg}; border: 1px solid {$themeStore.border}; color: {$themeStore.fg};"
    >
      <div
        class="panel-header"
        style="border-bottom: 1px solid {$themeStore.border};"
      >
        <span class="panel-title" style="color: {$themeStore.fg};"
          >Claude User Settings</span
        >
        <span class="panel-subtitle" style="color: {$themeStore.fgDim};"
          >~/.claude/settings.json</span
        >
        <button
          class="close-btn"
          style="color: {$themeStore.fgDim};"
          on:click={close}
          aria-label="Close">✕</button
        >
      </div>

      <div class="panel-body">
        {#if settingsPath}
          <SettingsFileEditor filePath={settingsPath} />
        {:else}
          <span style="color: {$themeStore.fgDim}; font-size: 12px;"
            >Loading…</span
          >
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: no-drag;
  }
  .overlay-panel {
    width: min(820px, 90vw);
    height: min(680px, 90vh);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  .panel-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    flex-shrink: 0;
  }
  .panel-title {
    font-size: 13px;
    font-weight: 600;
  }
  .panel-subtitle {
    font-size: 11px;
    font-family: monospace;
    flex: 1;
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .panel-body {
    flex: 1;
    overflow: hidden;
  }
</style>
