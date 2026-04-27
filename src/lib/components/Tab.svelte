<script lang="ts">
  import { tick } from "svelte";
  import { theme } from "../stores/theme";
  import { isMac } from "../terminal-service";
  import { shortcutHint } from "../actions/shortcut-hint";
  import type { Surface } from "../types";
  import { startTabDrag } from "../services/tab-drag";
  import { renamingSurfaceId } from "../stores/ui";
  import { renameSurface } from "../services/surface-service";

  export let surface: Surface;
  export let index: number;
  export let isActive: boolean;
  export let onSelect: () => void;
  export let onClose: () => void;
  /** Pane that owns this tab — needed to identify drop targets. */
  export let paneId: string;
  /** Workspace this tab lives in — needed for cross-workspace drops. */
  export let workspaceId: string;
  /** Optional agent dot color. When non-null, renders a colored dot next to the tab title. */
  export let agentDotColor: string | null = null;
  /** Optional agent status label ("running", "waiting", etc). */
  export let agentStatus: string | null = null;
  $: isWaiting = agentStatus === "waiting";

  let hovered = false;
  let closeHovered = false;
  let nameEl: HTMLSpanElement | null = null;
  let _renaming = false;

  $: {
    if ($renamingSurfaceId === surface.id && !_renaming) {
      void startRenameMode();
    } else if ($renamingSurfaceId !== surface.id && _renaming) {
      cancelRename();
    }
  }

  async function startRenameMode() {
    _renaming = true;
    await tick();
    if (!nameEl) return;
    nameEl.textContent = surface.title;
    nameEl.contentEditable = "true";
    nameEl.style.background = $theme.bgSurface;
    nameEl.style.border = `1px solid ${$theme.borderActive}`;
    nameEl.style.borderRadius = "3px";
    nameEl.style.padding = "0 3px";
    nameEl.style.outline = "none";
    nameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function finishRename() {
    if (!nameEl || !_renaming) return;
    nameEl.contentEditable = "false";
    nameEl.style.background = "transparent";
    nameEl.style.border = "none";
    nameEl.style.borderRadius = "";
    nameEl.style.padding = "";
    nameEl.style.outline = "";
    const newTitle = nameEl.textContent?.trim() ?? "";
    if (newTitle && newTitle !== surface.title) {
      renameSurface(surface.id, newTitle);
    } else {
      nameEl.textContent = surface.title || `Shell ${index + 1}`;
    }
    _renaming = false;
    renamingSurfaceId.set(null);
  }

  function cancelRename() {
    if (!nameEl || !_renaming) return;
    nameEl.contentEditable = "false";
    nameEl.style.background = "transparent";
    nameEl.style.border = "none";
    nameEl.style.borderRadius = "";
    nameEl.style.padding = "";
    nameEl.style.outline = "";
    nameEl.textContent = surface.title || `Shell ${index + 1}`;
    _renaming = false;
    renamingSurfaceId.set(null);
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      nameEl?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (nameEl) nameEl.textContent = surface.title;
      nameEl?.blur();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tab"
  data-tab-idx={index}
  data-tab-surface-id={surface.id}
  use:shortcutHint={isMac && index < 9 ? `Ctrl+${index + 1}` : undefined}
  style="
    padding: 2px 10px; font-size: 11px; cursor: pointer;
    color: {isActive ? $theme.fg : $theme.fgMuted};
    background: {isActive
    ? $theme.bgActive
    : hovered
      ? $theme.bgHighlight
      : 'transparent'};
    border-bottom: 2px solid {isActive ? $theme.accent : 'transparent'};
    border-radius: 4px 4px 0 0; white-space: nowrap;
    display: flex; align-items: center; gap: 4px;
  "
  on:click={onSelect}
  on:mouseenter={() => (hovered = true)}
  on:mouseleave={() => (hovered = false)}
  on:mousedown={(e) => {
    if (!_renaming) startTabDrag(e, surface.id, paneId, workspaceId);
  }}
>
  {#if agentDotColor}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke={agentDotColor}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="flex-shrink: 0;"
      aria-hidden="true"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
    <span
      role="img"
      aria-label={agentStatus ?? "agent"}
      class:pulse={isWaiting}
      style="
        width: {isWaiting ? 8 : 7}px; height: {isWaiting ? 8 : 7}px;
        border-radius: 50%; background: {agentDotColor}; flex-shrink: 0;
      "
    ></span>
  {:else if surface.hasUnread && !isActive}
    <span
      aria-label="Unread activity"
      style="width: 5px; height: 5px; border-radius: 50%; background: {$theme.notify}; flex-shrink: 0;"
    ></span>
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    bind:this={nameEl}
    style="
      overflow: hidden; text-overflow: ellipsis;
      {isWaiting ? `color: ${agentDotColor}; font-weight: 600;` : ''}
    "
    on:blur={finishRename}
    on:keydown={handleNameKeydown}
    on:dblclick|stopPropagation={() => renamingSurfaceId.set(surface.id)}
  >
    {#if !_renaming}{surface.title || `Shell ${index + 1}`}{/if}
  </span>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    style="
      color: {closeHovered
      ? $theme.danger
      : $theme.fgDim}; font-size: 13px; cursor: pointer;
      margin-left: 4px; visibility: {isActive || hovered
      ? 'visible'
      : 'hidden'};
    "
    on:click|stopPropagation={onClose}
    on:mouseenter={() => (closeHovered = true)}
    on:mouseleave={() => (closeHovered = false)}>×</span
  >
</div>

<style>
  .pulse {
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.25);
    }
  }
</style>
