<script lang="ts">
  import { onMount } from "svelte";
  import { theme } from "../stores/theme";
  import { isFullscreen, sidebarVisible } from "../stores/ui";
  import { spawnOrNavigate } from "../services/global-surface-service";
  import { isMac, modLabel, shiftModLabel } from "../terminal-service";
  import { shortcutHint } from "../actions/shortcut-hint";
  import { isDebugBuild } from "../services/service-helpers";
  import { titleBarButtonStore } from "../services/titlebar-button-registry";
  import { activeWorkspace, workspacesStore } from "../stores/workspace";
  import TitleBarContributedButton from "./TitleBarContributedButton.svelte";
  import NewWorkspaceSplitButton from "./NewWorkspaceSplitButton.svelte";
  import KeyboardIcon from "../icons/KeyboardIcon.svelte";
  import { runCommandById } from "../services/command-registry";

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

  $: titleBarBg = isDev ? DEV_ACCENT : $theme.bg;
  // On the yellow dev background we need dark glyphs for readability.
  $: btnFg = isDev ? "#1a1a1a" : $theme.fg;
  $: btnFgDim = isDev ? "#3a3a3a" : $theme.fgDim;

  // The centered TitleBar label always reflects the active root
  // Workspace. For a Branch, walk up to its owning root via
  // rootWorkspaceId; for a root Workspace, its own name is the answer.
  // Falls back to the product name when nothing is active.
  $: rootWorkspaceName = (() => {
    const ws = $activeWorkspace;
    if (!ws) return null;
    if (ws.rootWorkspaceId) {
      const root = $workspacesStore.find((r) => r.id === ws.rootWorkspaceId);
      if (root?.name) return root.name;
    }
    return ws.name ?? null;
  })();
  $: titleSuffix = isDev ? " (Dev)" : "";
  $: centeredTitle = rootWorkspaceName
    ? `${rootWorkspaceName}${titleSuffix}`
    : isDev
      ? "GnarTerm (Dev)"
      : "GnarTerm";
</script>

<div
  data-tauri-drag-region=""
  style="
    height: 38px; flex-shrink: 0; display: flex; align-items: center;
    padding: 0 8px 0 {leftPadding}; -webkit-app-region: drag;
    background: {titleBarBg}; border-bottom: 1px solid {$theme.border};
  "
>
  {#if !$sidebarVisible}
    <!-- Hosts the "+ New" split button while the primary sidebar is
         collapsed. Sits to the LEFT of the sidebar-toggle so creating
         a workspace stays in the same visual region as expanding the
         sidebar. The wrapper carries -webkit-app-region: no-drag so
         clicks don't initiate a window drag (the TitleBar itself is
         a Tauri drag region). -->
    <div style="margin-right: 4px; -webkit-app-region: no-drag;">
      <NewWorkspaceSplitButton />
    </div>
  {/if}

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
    <span class="title-ws" style="color: {isDev ? btnFg : $theme.fgDim};"
      >{centeredTitle}</span
    >
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
    <KeyboardIcon size={16} />
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
