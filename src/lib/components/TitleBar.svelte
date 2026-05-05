<script lang="ts">
  import { onMount } from "svelte";
  import { theme } from "../stores/theme";
  import { isFullscreen, sidebarVisible } from "../stores/ui";
  import { spawnOrNavigate } from "../services/dashboard-workspace-service";
  import { isMac, modLabel, shiftModLabel } from "../terminal-service";
  import { shortcutHint } from "../actions/shortcut-hint";
  import { isDebugBuild } from "../services/service-helpers";
  import { titleBarButtonStore } from "../services/titlebar-button-registry";
  import TitleBarContributedButton from "./TitleBarContributedButton.svelte";
  import { runCommandById } from "../services/command-registry";
  import { activeWorkspace } from "../stores/workspace";
  import { workspacesStore } from "../stores/workspace";

  // Single source of truth: cfg!(debug_assertions) from Rust, exposed via the
  // is_debug_build command. True for `tauri dev` and `tauri build --debug`,
  // false for `tauri build` (release). Seeded with import.meta.env.DEV to
  // avoid a flash on the dev server while the async command resolves.
  let isDev = import.meta.env.DEV;
  onMount(async () => {
    isDev = await isDebugBuild();
  });

  const DEV_ACCENT = "#C8900A";

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
  $: parentWorkspaceId = $activeWorkspace?.parentWorkspaceId ?? null;
  $: parentWorkspace = parentWorkspaceId
    ? ($workspacesStore.find((w) => w.id === parentWorkspaceId) ?? null)
    : null;

  $: titleBarBg = isDev ? DEV_ACCENT : $theme.bg;
  // On the yellow dev background we need dark glyphs for readability.
  $: btnFg = isDev ? "#1a1a1a" : $theme.fg;
  $: btnFgDim = isDev ? "#3a3a3a" : $theme.fgDim;

  // Derive workspace type for the title context suffix
  $: wsTypeSuffix = (() => {
    if (!$activeWorkspace) return null;
    const worktreePath = ($activeWorkspace as { worktreePath?: string })
      .worktreePath;
    const branch = ($activeWorkspace as { branch?: string }).branch;
    if ($activeWorkspace.isDashboard) return "Dashboard";
    if (worktreePath) return branch ?? "Branch";
    return "Workspace";
  })();

  $: titleText = parentWorkspace
    ? `${parentWorkspace.name} – ${wsTypeSuffix}`
    : ($activeWorkspace?.name ?? null);
</script>

<div
  data-tauri-drag-region=""
  style="
    height: 38px; flex-shrink: 0; display: flex; align-items: center;
    padding: 0 8px 0 {leftPadding}; -webkit-app-region: drag;
    background: {titleBarBg}; border-bottom: 1px solid {$theme.border};
  "
>
  <button
    style="{btnStyle} color: {$sidebarVisible ? btnFg : btnFgDim};"
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
    {#if $activeWorkspace && titleText}
      <span class="title-ws" style="color: {btnFg};">{titleText}</span>
    {:else}
      <span class="title-ws" style="color: {isDev ? btnFg : $theme.fgDim};"
        >{isDev ? "GNARTERM (DEV)" : "GNARTERM"}</span
      >
    {/if}
  </div>

  {#each $titleBarButtonStore as btn (btn.id)}
    <TitleBarContributedButton
      button={btn}
      {btnStyle}
      fg={btnFgDim}
      fgActive={btnFg}
    />
  {/each}

  <button
    style="{btnStyle} color: {btnFgDim};"
    title="Keyboard Shortcuts ({isMac ? '⌘/' : 'Ctrl+/'})"
    aria-label="Keyboard Shortcuts"
    use:shortcutHint={{ label: isMac ? "⌘/" : "Ctrl+/", placement: "below" }}
    on:click={() => runCommandById("core.show-keyboard-shortcuts")}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path d="M5.5 5.5 a2.5 2.5 0 1 1 3.5 2.3 c-1 0.5 -1 1.2 -1 2.2" /><circle
        cx="8"
        cy="12.5"
        r="0.6"
        fill="currentColor"
        stroke="none"
      /></svg
    >
  </button>

  <button
    style="{btnStyle} color: {btnFgDim};"
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
    max-width: 240px;
  }
</style>
