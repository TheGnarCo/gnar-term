<script lang="ts">
  import type { SplitNode, Workspace } from "../types";
  import { theme } from "../stores/theme";
  import { dragResize } from "../actions/drag-resize";
  import PaneView from "./PaneView.svelte";
  import SplitNodeView from "./SplitNodeView.svelte";

  export let node: SplitNode;
  export let workspace: Workspace;
  export let onSelectSurface: (paneId: string, surfaceId: string) => void;
  export let onCloseSurface: (paneId: string, surfaceId: string) => void;
  export let onNewSurface: (paneId: string) => void;
  export let onSplitRight: (paneId: string) => void;
  export let onSplitDown: (paneId: string) => void;
  export let onClosePane: (paneId: string) => void;
  export let onFocusPane: (paneId: string) => void;
  export let onReorderTab: ((paneId: string, fromIdx: number, toIdx: number) => void) | undefined = undefined;

  let dragging = false;
  let dragRect: DOMRect | null = null;

  $: splitDragOptions = {
    onStart: (e: MouseEvent) => {
      if (node.type !== "split") return false;
      dragging = true;
      dragRect = (e.target as HTMLElement).parentElement!.getBoundingClientRect();
    },
    onDrag: (ev: MouseEvent) => {
      if (node.type !== "split" || !dragRect) return;
      const isVertical = node.direction === "vertical";
      const pos = isVertical
        ? (ev.clientY - dragRect.top) / dragRect.height
        : (ev.clientX - dragRect.left) / dragRect.width;
      node.ratio = Math.max(0.1, Math.min(0.9, pos));
    },
    onEnd: () => {
      dragging = false;
      dragRect = null;
    },
  };
</script>

{#if node.type === "pane"}
  <PaneView
    pane={node.pane}
    isActivePane={node.pane.id === workspace.activePaneId}
    onSelectSurface={(sid) => onSelectSurface(node.pane.id, sid)}
    onCloseSurface={(sid) => onCloseSurface(node.pane.id, sid)}
    onNewSurface={() => onNewSurface(node.pane.id)}
    onSplitRight={() => onSplitRight(node.pane.id)}
    onSplitDown={() => onSplitDown(node.pane.id)}
    onClosePane={() => onClosePane(node.pane.id)}
    onFocusPane={() => onFocusPane(node.pane.id)}
    onReorderTab={onReorderTab ? (from, to) => onReorderTab!(node.pane.id, from, to) : undefined}
  />
{:else}
  <div style="
    display: flex; flex: 1; min-width: 0; min-height: 0; gap: 0;
    flex-direction: {node.direction === 'vertical' ? 'column' : 'row'};
  ">
    <div style="flex: {node.ratio}; display: flex; min-width: 0; min-height: 0;">
      <SplitNodeView
        node={node.children[0]}
        {workspace}
        {onSelectSurface}
        {onCloseSurface}
        {onNewSurface}
        {onSplitRight}
        {onSplitDown}
        {onClosePane}
        {onFocusPane}
        {onReorderTab}
      />
    </div>
    <div
      class="split-divider"
      style="
        {node.direction === 'vertical' ? 'height: 6px; cursor: row-resize;' : 'width: 6px; cursor: col-resize;'}
        background: {dragging ? $theme.accent : $theme.border};
        flex-shrink: 0;
        transition: background 0.15s;
      "
      use:dragResize={splitDragOptions}
    ></div>
    <div style="flex: {1 - node.ratio}; display: flex; min-width: 0; min-height: 0;">
      <SplitNodeView
        node={node.children[1]}
        {workspace}
        {onSelectSurface}
        {onCloseSurface}
        {onNewSurface}
        {onSplitRight}
        {onSplitDown}
        {onClosePane}
        {onFocusPane}
        {onReorderTab}
      />
    </div>
  </div>
{/if}

<style>
  .split-divider:hover {
    filter: brightness(1.3);
  }
</style>
