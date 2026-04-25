<script lang="ts">
  import { theme } from "../stores/theme";
  import type { Surface } from "../types";
  import { startTabDrag } from "../services/tab-drag";

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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tab"
  data-tab-idx={index}
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
  on:mousedown={(e) => startTabDrag(e, surface.id, paneId, workspaceId)}
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
      title={agentStatus ?? "agent"}
      class:pulse={isWaiting}
      style="
        width: {isWaiting ? 8 : 7}px; height: {isWaiting ? 8 : 7}px;
        border-radius: 50%; background: {agentDotColor}; flex-shrink: 0;
      "
    ></span>
  {:else if surface.hasUnread && !isActive}
    <span
      style="width: 5px; height: 5px; border-radius: 50%; background: {$theme.notify}; flex-shrink: 0;"
    ></span>
  {/if}
  <span
    style="
      overflow: hidden; text-overflow: ellipsis;
      {isWaiting ? `color: ${agentDotColor}; font-weight: 600;` : ''}
    "
  >
    {surface.title || `Shell ${index + 1}`}
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
