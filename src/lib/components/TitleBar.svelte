<script lang="ts">
  import { onMount } from "svelte";
  import { theme } from "../stores/theme";
  import { isFullscreen, sidebarVisible } from "../stores/ui";
  import { spawnOrNavigate } from "../services/dashboard-workspace-service";
  import { isMac, modLabel, shiftModLabel } from "../terminal-service";
  import { shortcutHint } from "../actions/shortcut-hint";
  import { isDebugBuild, wsMeta } from "../services/service-helpers";
  import { titleBarButtonStore } from "../services/titlebar-button-registry";
  import TitleBarContributedButton from "./TitleBarContributedButton.svelte";
  import { activeWorkspace } from "../stores/nested-workspace";
  import { workspacesStore } from "../stores/workspaces";

  // Single source of truth: cfg!(debug_assertions) from Rust, exposed via the
  // is_debug_build command. True for `tauri dev` and `tauri build --debug`,
  // false for `tauri build` (release). Seeded with import.meta.env.DEV to
  // avoid a flash on the dev server while the async command resolves.
  let isDev = import.meta.env.DEV;
  onMount(async () => {
    isDev = await isDebugBuild();
  });

  const DEV_BG = "#C8900A";
  const DEV_FG = "#1C0F00";

  $: bg = isDev ? DEV_BG : $theme.bg;
  $: fg = isDev ? DEV_FG : $theme.fgDim;
  $: fgActive = isDev ? DEV_FG : $theme.fg;

  let btnStyle = "";
  $: btnStyle = `
    background: none; border: none; cursor: pointer;
    width: 26px; height: 26px; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    padding: 0; -webkit-app-region: no-drag;
  `;

  // macOS traffic lights (close/min/max) overlay the top-left of the window
  // when `titleBarStyle: Overlay` is set. When the primary sidebar is visible,
  // it sits to the left of the TitleBar and absorbs that space. When it's
  // hidden (and we're not fullscreen), the TitleBar starts at x=0, so push
  // its first button well past the traffic-light cluster.
  $: leftPadding = !$sidebarVisible && isMac && !$isFullscreen ? "84px" : "8px";
  $: branch = $activeWorkspace?.metadata?.branch ?? null;
  $: parentWorkspaceId = $activeWorkspace
    ? wsMeta($activeWorkspace).parentWorkspaceId
    : null;
  $: umbrellaName = parentWorkspaceId
    ? ($workspacesStore.find((w) => w.id === parentWorkspaceId)?.name ?? null)
    : null;
  $: showUmbrella = umbrellaName && umbrellaName !== $activeWorkspace?.name;
  $: showBranch = branch && branch !== $activeWorkspace?.name;
</script>

<div
  data-tauri-drag-region=""
  style="
    height: 38px; flex-shrink: 0; display: flex; align-items: center;
    padding: 0 8px 0 {leftPadding}; -webkit-app-region: drag;
    background: {bg}; border-bottom: 1px solid {isDev ? DEV_FG : $theme.border};
  "
>
  <button
    style="{btnStyle} color: {$sidebarVisible ? fgActive : fg};"
    title="Toggle Sidebar ({isMac ? modLabel : shiftModLabel}B)"
    aria-label="Toggle Sidebar"
    use:shortcutHint={{
      label: isMac ? `${modLabel}B` : `${shiftModLabel}B`,
      placement: "below",
    }}
    on:click={() => sidebarVisible.update((v) => !v)}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      ><rect x="1" y="2" width="14" height="12" rx="1.5" /><line
        x1="5.5"
        y1="2"
        x2="5.5"
        y2="14"
      /></svg
    >
  </button>

  <div
    style="flex: 1; display: flex; justify-content: center; align-items: center; pointer-events: none;"
  >
    {#if $activeWorkspace}
      {#if showUmbrella}
        <span class="title-ws" style="color: {fg};">{umbrellaName}</span>
        <span class="title-sep" aria-hidden="true">·</span>
      {/if}
      <span class="title-ws" style="color: {fgActive};"
        >{$activeWorkspace.name}</span
      >
      {#if showBranch}
        <span class="title-sep" aria-hidden="true">·</span>
        <span class="title-branch" style="color: {fg};">{branch}</span>
      {/if}
    {:else}
      <span class="title-ws" style="color: {fg};"
        >{isDev ? "GNARTERM (DEV)" : "GNARTERM"}</span
      >
    {/if}
  </div>

  {#each $titleBarButtonStore as btn (btn.id)}
    <TitleBarContributedButton button={btn} {btnStyle} {fg} {fgActive} />
  {/each}

  <button
    style="{btnStyle} color: {fg};"
    title="Settings ({modLabel},)"
    aria-label="Settings"
    use:shortcutHint={{ label: isMac ? "⌘," : "Ctrl+,", placement: "below" }}
    on:click={() => void spawnOrNavigate("gnar-term:settings")}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      ><path
        d="M6.8 1.5h2.4l.3 1.9.8.3 1.6-1 1.7 1.7-1 1.6.3.8 1.9.3v2.4l-1.9.3-.3.8 1 1.6-1.7 1.7-1.6-1-.8.3-.3 1.9H6.8l-.3-1.9-.8-.3-1.6 1-1.7-1.7 1-1.6-.3-.8-1.9-.3V6.8l1.9-.3.3-.8-1-1.6 1.7-1.7 1.6 1 .8-.3z"
      /><circle cx="8" cy="8" r="2" /></svg
    >
  </button>
</div>

<style>
  .title-ws {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 1.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
  }

  .title-sep {
    opacity: 0.4;
    margin: 0 4px;
    font-size: 11px;
    flex-shrink: 0;
  }

  .title-branch {
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0;
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
  }
</style>
