<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import SettingsFileEditor from "./SettingsFileEditor.svelte";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const themeStore = api.theme;

  let homePath = "";
  $: settingsPath = homePath ? `${homePath}/.claude/settings.json` : "";

  onMount(async () => {
    homePath = await api.invoke<string>("get_home");
  });
</script>

<div
  style="
    height: 100%; display: flex; flex-direction: column;
    background: {$themeStore.bg}; color: {$themeStore.fg};
  "
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
  </div>

  <div class="panel-body">
    {#if settingsPath}
      <SettingsFileEditor filePath={settingsPath} />
    {:else}
      <span style="color: {$themeStore.fgDim}; font-size: 12px;">Loading…</span>
    {/if}
  </div>
</div>

<style>
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
  .panel-body {
    flex: 1;
    overflow: hidden;
  }
</style>
