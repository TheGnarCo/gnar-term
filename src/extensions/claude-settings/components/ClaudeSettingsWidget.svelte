<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import {
    getDashboardHost,
    deriveDashboardScope,
  } from "../../../lib/contexts/dashboard-host";
  import { getWorkspaceGroup } from "../../../lib/stores/workspace-groups";
  import SettingsFileEditor from "./SettingsFileEditor.svelte";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const themeStore = api.theme;

  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);

  $: group =
    scope.kind === "group" ? getWorkspaceGroup(scope.groupId) : undefined;
  $: projectRoot = group?.path ?? "";

  $: settingsPath = projectRoot ? `${projectRoot}/.claude/settings.json` : null;
  $: localSettingsPath = projectRoot
    ? `${projectRoot}/.claude/settings.local.json`
    : null;

  let activeTab: "settings" | "local" = "settings";

  $: t = {
    fg: $themeStore.fg,
    fgDim: $themeStore.fgDim,
    bg: $themeStore.bg,
    border: $themeStore.border,
  };
</script>

<div
  class="widget"
  style="background: {t.bg}; color: {t.fg}; height: 100%; display: flex; flex-direction: column;"
>
  {#if !projectRoot}
    <div style="padding: 16px; color: {t.fgDim}; font-size: 12px;">
      No workspace group associated with this dashboard.
    </div>
  {:else}
    <!-- Tab bar -->
    <div class="tab-bar" style="border-bottom: 1px solid {t.border};">
      <button
        class="tab"
        class:active={activeTab === "settings"}
        style="color: {activeTab === 'settings'
          ? t.fg
          : t.fgDim}; border-bottom: 2px solid {activeTab === 'settings'
          ? t.fg
          : 'transparent'};"
        on:click={() => (activeTab = "settings")}
      >
        settings.json
      </button>
      <button
        class="tab"
        class:active={activeTab === "local"}
        style="color: {activeTab === 'local'
          ? t.fg
          : t.fgDim}; border-bottom: 2px solid {activeTab === 'local'
          ? t.fg
          : 'transparent'};"
        on:click={() => (activeTab = "local")}
      >
        settings.local.json
      </button>
    </div>

    <!-- Editor -->
    <div class="editor-container">
      {#if activeTab === "settings" && settingsPath}
        <SettingsFileEditor
          filePath={settingsPath}
          label="Project settings"
          baseDir="{projectRoot}/.claude"
        />
      {:else if activeTab === "local" && localSettingsPath}
        <SettingsFileEditor
          filePath={localSettingsPath}
          label="Local settings (gitignored)"
          baseDir="{projectRoot}/.claude"
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .tab-bar {
    display: flex;
    padding: 0 8px;
    flex-shrink: 0;
  }
  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    padding: 8px 12px;
    font-size: 12px;
    font-family: monospace;
    transition: color 0.1s;
  }
  .editor-container {
    flex: 1;
    overflow: hidden;
  }
</style>
