<script lang="ts">
  import { tick } from "svelte";
  import { theme } from "../stores/theme";

  $: isDisco = $theme.name === "Molly Disco";
  import { getAllPanes, getAllSurfaces } from "../types";
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
    return discoEmojis[Math.abs(h) % discoEmojis.length];
  }
  function discoColorFor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 37 + id.charCodeAt(i)) | 0;
    return discoColors[Math.abs(h) % discoColors.length];
  }

  export let workspace: Workspace;
  export let index: number;
  export let isActive: boolean;
  export let onSelect: () => void;
  export let onClose: () => void;
  export let onRename: (name: string) => void;
  export let onContextMenu: (x: number, y: number) => void;

  let hovered = false;
  let closeHovered = false;
  let nameEl: HTMLSpanElement;
  let _renaming = false;

  $: allSurfaces = getAllSurfaces(workspace);
  $: hasUnread = allSurfaces.some((s) => s.hasUnread);
  $: paneCount = getAllPanes(workspace.splitRoot).length;
  $: surfaceCount = allSurfaces.length;
  $: latestNotification = allSurfaces.find((s) => s.notification)?.notification;
  $: isManaged = !!workspace.metadata?.worktreePath;
  $: metaParts = [
    ...(paneCount > 1 ? [`${paneCount}p`] : []),
    ...(surfaceCount > 1 ? [`${surfaceCount}s`] : []),
  ];

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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-drag-idx={index}
  style="
    margin: 2px 8px; border-radius: 6px; overflow: hidden;
    background: {isActive
    ? $theme.bgActive
    : hovered
      ? $theme.bgHighlight
      : 'transparent'};
    border-left: 3px solid {isActive ? $theme.accent : 'transparent'};
    transition: opacity 0.15s;
    opacity: {dragActive ? 0.4 : 1};
  "
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    style="padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px;"
    on:click={onSelect}
    on:contextmenu|preventDefault={(e) => onContextMenu(e.clientX, e.clientY)}
    on:mouseenter={() => (hovered = true)}
    on:mouseleave={() => {
      hovered = false;
      closeHovered = false;
    }}
  >
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
          title="Git worktree workspace"
        >
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

    {#if metaParts.length > 0}
      <span
        style="font-size: 10px; color: {$theme.fgDim}; background: {$theme.bgSurface}; padding: 1px 5px; border-radius: 8px;"
      >
        {metaParts.join(" ")}
      </span>
    {/if}

    {#if hasUnread}
      <span
        style="width: 8px; height: 8px; border-radius: 50%; background: {$theme.notify}; flex-shrink: 0;"
      ></span>
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

  {#if latestNotification}
    <div
      style="padding: 2px 12px 6px; font-size: 11px; color: {$theme.notify}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
    >
      {latestNotification}
    </div>
  {/if}
</div>
