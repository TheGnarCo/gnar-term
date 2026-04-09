<script lang="ts">
  import { theme } from "../stores/theme";
  import { contextMenu } from "../stores/ui";
  import { showInputPrompt } from "../stores/dialog-service";
  import type { Surface } from "../types";
  import { isHarnessSurface } from "../types";
  import type { AgentStatus } from "../types";
  import type { MenuItem } from "../context-menu-types";

  export let surface: Surface;
  export let index: number;
  export let isActive: boolean;
  export let onSelect: () => void;
  export let onClose: () => void;
  export let onRename: ((newTitle: string) => void) | undefined = undefined;
  export let onReorder: ((fromIdx: number, toIdx: number) => void) | undefined =
    undefined;

  let hovered = false;
  let closeHovered = false;
  let dragOver = false;

  const STATUS_COLORS: Record<AgentStatus, string> = {
    idle: "#4caf50",
    running: "#ffb300",
    waiting: "#42a5f5",
    error: "#ef5350",
    exited: "#9e9e9e",
  };

  $: harnessStatus = isHarnessSurface(surface)
    ? ((surface as any).status as AgentStatus)
    : null;
  $: statusColor = harnessStatus ? STATUS_COLORS[harnessStatus] : null;

  function handleDragStart(e: DragEvent) {
    e.dataTransfer?.setData("text/plain", index.toString());
    e.dataTransfer!.effectAllowed = "move";
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    const items: MenuItem[] = [];
    if (onRename) {
      items.push({
        label: "Rename",
        action: async () => {
          const newTitle = await showInputPrompt("Rename tab", surface.title);
          if (newTitle && newTitle !== surface.title) onRename(newTitle);
        },
      });
    }
    items.push(
      { label: "", action: () => {}, separator: true },
      { label: "Close", shortcut: "\u2318W", danger: true, action: onClose },
    );
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const fromIdx = parseInt(e.dataTransfer?.getData("text/plain") || "-1", 10);
    if (fromIdx >= 0 && fromIdx !== index && onReorder) {
      onReorder(fromIdx, index);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tab"
  draggable="true"
  style="
    padding: 2px 10px; font-size: 11px; cursor: pointer;
    color: {isActive ? $theme.fg : $theme.fgMuted};
    background: {isActive
    ? $theme.bgActive
    : hovered
      ? $theme.bgHighlight
      : 'transparent'};
    border-bottom: none;
    border-radius: 4px 4px 0 0; white-space: nowrap;
    display: flex; align-items: center; gap: 4px;
    {dragOver ? `outline: 1px solid ${$theme.accent};` : ''}
  "
  on:click={onSelect}
  on:mouseenter={() => (hovered = true)}
  on:mouseleave={() => (hovered = false)}
  on:contextmenu={handleContextMenu}
  on:dragstart={handleDragStart}
  on:dragover|preventDefault={() => (dragOver = true)}
  on:dragleave={() => (dragOver = false)}
  on:drop={handleDrop}
>
  {#if statusColor}
    <span
      data-status-dot
      style="width: 6px; height: 6px; border-radius: 50%; background: {statusColor}; flex-shrink: 0;"
    ></span>
  {:else if surface.hasUnread && !isActive}
    <span
      style="width: 5px; height: 5px; border-radius: 50%; background: {$theme.notify}; flex-shrink: 0;"
    ></span>
  {/if}
  <span style="overflow: hidden; text-overflow: ellipsis;">
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
