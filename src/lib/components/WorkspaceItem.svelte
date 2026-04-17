<script lang="ts">
  import { tick, type Component } from "svelte";
  import { theme } from "../stores/theme";
  import { agentStatusStore } from "../stores/agent-status";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import { aggregateAgentBadges } from "../status-colors";
  import { workspaceSubtitleStore } from "../services/workspace-subtitle-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import DragGrip from "./DragGrip.svelte";

  $: isDisco = $theme.name === "Molly Disco";
  import { getAllSurfaces } from "../types";
  import type { Workspace } from "../types";

  const discoEmojis = [
    "✨",
    "🦄",
    "🌈",
    "💜",
    "🪩",
    "⚡",
    "💫",
    "🔮",
    "🎀",
    "💎",
    "🌸",
    "🍭",
    "🫧",
    "💗",
    "🦋",
    "🎠",
    "🧚",
    "💖",
    "🌺",
    "🎵",
    "🩵",
    "🪻",
    "🎪",
    "🧸",
    "🌟",
    "💐",
    "🩷",
    "🏄",
    "🐬",
    "🌊",
    "🎨",
    "🧜",
    "🫶",
    "💕",
    "🌙",
    "🐾",
    "🍬",
    "🎶",
    "🌻",
    "🐱",
    "💝",
    "🎈",
    "🪼",
    "🦩",
    "🫀",
    "🧁",
    "🍩",
    "🎯",
  ];
  const discoColors = [
    "#e91e63",
    "#c026d3",
    "#2979ff",
    "#00bfa5",
    "#ff4081",
    "#e040fb",
    "#448aff",
    "#1de9b6",
    "#ff9100",
    "#18ffff",
  ];

  // Stable emoji per workspace based on id hash
  function discoEmojiFor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return discoEmojis[Math.abs(h) % discoEmojis.length] ?? "";
  }
  function discoColorFor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 37 + id.charCodeAt(i)) | 0;
    return discoColors[Math.abs(h) % discoColors.length] ?? "";
  }

  export let workspace: Workspace;
  export let index: number;
  export let isActive: boolean;
  export let onSelect: () => void;
  export let onClose: () => void;
  export let onRename: (name: string) => void;
  export let onContextMenu: (x: number, y: number) => void;
  /** Project accent color — when set, overrides the default border-left styling. */
  export let accentColor: string | undefined = undefined;

  let hovered = false;
  let closeHovered = false;
  let nameEl: HTMLSpanElement;
  let _renaming = false;

  $: allSurfaces = getAllSurfaces(workspace);
  $: hasUnread = allSurfaces.some((s) => s.hasUnread);
  $: latestNotification = allSurfaces.find((s) => s.notification)?.notification;
  $: isManaged = !!workspace.metadata?.worktreePath;
  // Legacy agent status — kept for backwards compatibility
  $: agentStatus = $agentStatusStore[workspace.id] || null;
  $: agentDotColor =
    agentStatus === "running"
      ? "#4ec957"
      : agentStatus === "waiting"
        ? "#e8b73a"
        : agentStatus === "idle"
          ? "#888888"
          : null;

  // Status registry subscriptions (process items for agent dots)
  $: processStatusStore = getWorkspaceStatusByCategory(workspace.id, "process");
  $: processItems = $processStatusStore;
  $: agentBadges = aggregateAgentBadges(processItems);
  // Count per-surface agent items (items with metadata.surfaceId)
  $: perSurfaceAgents = processItems.filter(
    (item) => typeof item.metadata?.surfaceId === "string",
  );
  $: agentCount = perSurfaceAgents.length;

  $: subtitleComponents = $workspaceSubtitleStore;

  export async function startRename() {
    _renaming = true;
    await tick();
    if (!nameEl) return;
    nameEl.contentEditable = "true";
    nameEl.style.background = $theme.bgSurface;
    nameEl.style.border = `1px solid ${$theme.borderActive}`;
    nameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function finishRename() {
    if (!nameEl) return;
    nameEl.contentEditable = "false";
    nameEl.style.background = "transparent";
    nameEl.style.border = "none";
    const newName = nameEl.textContent?.trim();
    if (newName && newName !== workspace.name) {
      onRename(newName);
    } else {
      nameEl.textContent = workspace.name;
    }
    _renaming = false;
  }

  export let dragActive = false;
  /** Mousedown handler fired when the drag grip is pressed. Drag origin, not row body. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  data-drag-idx={index}
  style="
    position: relative;
    margin: 2px 8px; border-radius: 6px; overflow: hidden; cursor: pointer;
    background: {isActive
    ? $theme.bgActive
    : hovered
      ? $theme.bgHighlight
      : 'transparent'};
    border-left: 3px solid {isActive
    ? accentColor || $theme.accent
    : `color-mix(in srgb, ${accentColor || $theme.accent} 35%, transparent)`};
    transition: opacity 0.15s;
    opacity: {dragActive ? 0.4 : 1};
  "
  on:click={onSelect}
  on:contextmenu|preventDefault={(e) => onContextMenu(e.clientX, e.clientY)}
  on:mouseenter={() => (hovered = true)}
  on:mouseleave={() => {
    hovered = false;
    closeHovered = false;
  }}
>
  {#if onGripMouseDown}
    <DragGrip
      theme={$theme}
      visible={hovered}
      onMouseDown={onGripMouseDown}
      ariaLabel="Drag workspace to reorder"
    />
  {/if}
  <div style="padding: 8px 12px; display: flex; align-items: center; gap: 8px;">
    <div
      style="flex: 1; overflow: hidden; display: flex; align-items: center; gap: 4px;"
    >
      {#if isManaged}
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="flex-shrink: 0; color: {$theme.fgDim};"
        >
          <title>Git worktree workspace</title>
          <circle cx="4" cy="4" r="2" />
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="8" r="2" />
          <path d="M4 6 L4 10" />
          <path d="M6 4 C8 4 10 6 10 8" />
        </svg>
      {/if}
      <span
        bind:this={nameEl}
        style="
          font-weight: {isActive ? '600' : '400'};
          color: {isDisco
          ? discoColorFor(workspace.id)
          : isActive
            ? $theme.fg
            : $theme.fgMuted};
          font-size: 13px; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
          outline: none; padding: 2px 4px; margin-left: -4px; border-radius: 4px;
        "
        on:blur={finishRename}
        on:keydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            nameEl.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            nameEl.textContent = workspace.name;
            nameEl.blur();
          }
        }}
        >{#if isDisco}{discoEmojiFor(workspace.id)}
        {/if}{workspace.name}</span
      >
    </div>

    {#if agentBadges.length > 0 && agentBadges[0]}
      {@const topBadge = agentBadges[0]}
      {@const statusLabel =
        topBadge.variant === "success"
          ? "running"
          : topBadge.variant === "warning"
            ? "waiting"
            : topBadge.variant === "muted"
              ? "idle"
              : topBadge.variant === "error"
                ? "error"
                : ""}
      <span
        title={agentBadges.map((b) => b.label).join(", ")}
        style="
          display: inline-flex; align-items: center; gap: 3px;
          font-size: 10px; color: {topBadge.color};
          background: color-mix(in srgb, {topBadge.color} 15%, transparent);
          padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
        "
      >
        <span
          style="width: 6px; height: 6px; border-radius: 50%; background: {topBadge.color};"
        ></span>
        {#if agentCount > 1}{agentCount}
        {/if}{statusLabel}
      </span>
    {:else if agentDotColor}
      <span
        title="Agent: {agentStatus}"
        style="
          display: inline-flex; align-items: center; gap: 3px;
          font-size: 10px; color: {agentDotColor};
          background: color-mix(in srgb, {agentDotColor} 15%, transparent);
          padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
        "
      >
        <span
          style="width: 6px; height: 6px; border-radius: 50%; background: {agentDotColor};"
        ></span>
        {agentStatus}
      </span>
    {/if}

    {#if hasUnread && !agentDotColor && agentBadges.length === 0}
      <span
        title="Workspace has new terminal activity"
        style="
          display: inline-flex; align-items: center; gap: 3px;
          font-size: 10px; color: {$theme.notify};
          background: color-mix(in srgb, {$theme.notify} 15%, transparent);
          padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
        "
      >
        <span
          style="width: 6px; height: 6px; border-radius: 50%; background: {$theme.notify};"
        ></span>
        new
      </span>
    {/if}

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <span
      title="Close Workspace (⇧⌘W)"
      style="
        color: {closeHovered
        ? $theme.danger
        : $theme.fgDim}; font-size: 14px; cursor: pointer;
        opacity: {hovered ? '1' : '0'}; transition: opacity 0.15s;
        padding: 0 2px; flex-shrink: 0;
      "
      on:click|stopPropagation={onClose}
      on:mouseenter={() => (closeHovered = true)}
      on:mouseleave={() => (closeHovered = false)}>×</span
    >
  </div>

  {#each subtitleComponents as sub (sub.id)}
    {@const subApi = getExtensionApiById(sub.source)}
    {#if subApi}
      <ExtensionWrapper
        api={subApi}
        component={sub.component}
        props={{ workspaceId: workspace.id }}
      />
    {:else}
      <svelte:component
        this={sub.component as Component}
        workspaceId={workspace.id}
      />
    {/if}
  {/each}

  {#if latestNotification}
    <div
      style="padding: 2px 12px 6px; font-size: 11px; color: {$theme.notify}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
    >
      {latestNotification}
    </div>
  {/if}
</div>
