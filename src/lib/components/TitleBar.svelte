<script lang="ts">
  import { theme } from "../stores/theme";
  import {
    isFullscreen,
    primarySidebarVisible,
    secondarySidebarVisible,
    settingsOpen,
  } from "../stores/ui";
  import { isMac, modLabel } from "../terminal-service";

  let btnStyle = "";
  $: btnStyle = `
    background: none; border: none; cursor: pointer;
    width: 26px; height: 26px; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    padding: 0; -webkit-app-region: no-drag;
  `;

  $: leftPadding =
    !$primarySidebarVisible && isMac && !$isFullscreen ? "78px" : "8px";
</script>

<div
  data-tauri-drag-region=""
  style="
    height: 38px; flex-shrink: 0; display: flex; align-items: center;
    padding: 0 8px 0 {leftPadding}; -webkit-app-region: drag;
    background: {$theme.bg}; border-bottom: 1px solid {$theme.border};
  "
>
  <button
    style="{btnStyle} color: {$primarySidebarVisible
      ? $theme.fg
      : $theme.fgDim};"
    title="Toggle Primary Sidebar ({modLabel}B)"
    on:click={() => primarySidebarVisible.update((v) => !v)}
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
    style="flex: 1; display: flex; justify-content: center; pointer-events: none;"
  >
    <span
      style="
      font-size: 11px; font-weight: 600; letter-spacing: 1.5px;
      color: {$theme.fgDim};
    ">GNARTERM</span
    >
  </div>

  <button
    style="{btnStyle} color: {$settingsOpen ? $theme.fg : $theme.fgDim};"
    title="Settings ({modLabel},)"
    on:click={() => settingsOpen.update((v) => !v)}
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

  <button
    style="{btnStyle} color: {$secondarySidebarVisible
      ? $theme.fg
      : $theme.fgDim};"
    title="Toggle Secondary Sidebar"
    on:click={() => secondarySidebarVisible.update((v) => !v)}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      ><rect x="1" y="2" width="14" height="12" rx="1.5" /><line
        x1="10.5"
        y1="2"
        x2="10.5"
        y2="14"
      /></svg
    >
  </button>
</div>
