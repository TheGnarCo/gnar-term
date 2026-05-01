<script lang="ts">
  import type { SplitNode, NestedWorkspace } from "../types";
  import { nodeContainsSurface } from "../types";
  import { theme } from "../stores/theme";
  import { zoomedSurfaceId } from "../stores/workspace";
  import { dragResize } from "../actions/drag-resize";
  import { schedulePersist } from "../services/workspace-service";
  import PaneView from "./PaneView.svelte";
  import SplitNodeView from "./SplitNodeView.svelte";

  export let node: SplitNode;
  export let workspace: NestedWorkspace;
  export let onSelectSurface: (paneId: string, surfaceId: string) => void;
  export let onCloseSurface: (paneId: string, surfaceId: string) => void;
  export let onNewSurface: (paneId: string) => void;
  export let onSelectSurfaceType: (paneId: string, typeId: string) => void;
  export let onSplitRight: (paneId: string) => void;
  export let onSplitDown: (paneId: string) => void;
  export let onClosePane: (paneId: string) => void;
  export let onFocusPane: (paneId: string) => void;

  let dragging = false;
  let dragRect: DOMRect | null = null;
  let localRatio = 0.5;
  $: localRatio = node.type === "split" ? node.ratio : 0.5;

  $: splitDragOptions = {
    onStart: (e: MouseEvent) => {
      if (node.type !== "split") return false;
      dragging = true;
      dragRect = (
        e.target as HTMLElement
      ).parentElement!.getBoundingClientRect();
    },
    onDrag: (ev: MouseEvent) => {
      if (node.type !== "split" || !dragRect) return;
      const isVertical = node.direction === "vertical";
      const pos = isVertical
        ? (ev.clientY - dragRect.top) / dragRect.height
        : (ev.clientX - dragRect.left) / dragRect.width;
      localRatio = Math.max(0.1, Math.min(0.9, pos));
      node.ratio = localRatio;
    },
    onEnd: () => {
      dragging = false;
      dragRect = null;
      schedulePersist();
    },
  };
</script>

{#if node.type === "pane"}
  <PaneView
    pane={node.pane}
    workspaceId={workspace.id}
    isActive={workspace.activePaneId === node.pane.id}
    onSelectSurface={(sid) => onSelectSurface(node.pane.id, sid)}
    onCloseSurface={(sid) => onCloseSurface(node.pane.id, sid)}
    onNewSurface={() => onNewSurface(node.pane.id)}
    onSelectSurfaceType={(typeId) => onSelectSurfaceType(node.pane.id, typeId)}
    onSplitRight={() => onSplitRight(node.pane.id)}
    onSplitDown={() => onSplitDown(node.pane.id)}
    onClosePane={() => onClosePane(node.pane.id)}
    onFocusPane={() => onFocusPane(node.pane.id)}
  />
{:else}
  {@const zoomed = $zoomedSurfaceId}
  {@const child0HasZoom = zoomed
    ? nodeContainsSurface(node.children[0], zoomed)
    : false}
  {@const child1HasZoom = zoomed
    ? nodeContainsSurface(node.children[1], zoomed)
    : false}
  {@const zoomActive = child0HasZoom || child1HasZoom}
  <div
    style="
    display: flex; flex: 1; min-width: 0; min-height: 0; gap: 0;
    flex-direction: {node.direction === 'vertical' ? 'column' : 'row'};
  "
  >
    <div
      style="
        flex: {zoomActive ? (child0HasZoom ? 1 : 0) : localRatio};
        display: {zoomActive && !child0HasZoom ? 'none' : 'flex'};
        min-width: 0; min-height: 0;
      "
    >
      <SplitNodeView
        node={node.children[0]}
        {workspace}
        {onSelectSurface}
        {onCloseSurface}
        {onNewSurface}
        {onSelectSurfaceType}
        {onSplitRight}
        {onSplitDown}
        {onClosePane}
        {onFocusPane}
      />
    </div>
    {#if !zoomActive}
      <div
        class="split-divider"
        style="
          {node.direction === 'vertical'
          ? 'height: 6px; cursor: row-resize;'
          : 'width: 6px; cursor: col-resize;'}
          background: {dragging ? $theme.accent : $theme.border};
          flex-shrink: 0;
          transition: background 0.15s;
        "
        use:dragResize={splitDragOptions}
      ></div>
    {/if}
    <div
      style="
        flex: {zoomActive ? (child1HasZoom ? 1 : 0) : 1 - localRatio};
        display: {zoomActive && !child1HasZoom ? 'none' : 'flex'};
        min-width: 0; min-height: 0;
      "
    >
      <SplitNodeView
        node={node.children[1]}
        {workspace}
        {onSelectSurface}
        {onCloseSurface}
        {onNewSurface}
        {onSelectSurfaceType}
        {onSplitRight}
        {onSplitDown}
        {onClosePane}
        {onFocusPane}
      />
    </div>
  </div>
{/if}

<style>
  .split-divider:hover {
    filter: brightness(1.3);
  }
</style>
