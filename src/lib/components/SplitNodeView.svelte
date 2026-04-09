<script lang="ts">
  import type { SplitNode, Workspace } from "../types";
  import { theme } from "../stores/theme";
  import PaneView from "./PaneView.svelte";
  import SplitNodeView from "./SplitNodeView.svelte";

  export let node: SplitNode;
  export let workspace: Workspace;
  export let onSelectSurface: (paneId: string, surfaceId: string) => void;
  export let onCloseSurface: (paneId: string, surfaceId: string) => void;
  export let onNewSurface: (paneId: string) => void;
  export let onNewHarnessSurface:
    | ((paneId: string, presetId: string) => void)
    | undefined = undefined;
  export let onSwitchSurface:
    | ((paneId: string, kind: string, presetId?: string) => void)
    | undefined = undefined;
  export let onSplitRight: (paneId: string) => void;
  export let onSplitDown: (paneId: string) => void;
  export let onClosePane: (paneId: string) => void;
  export let onFocusPane: (paneId: string) => void;
  export let onRenameTab:
    | ((paneId: string, surfaceId: string, newTitle: string) => void)
    | undefined = undefined;
  export let onReorderTab:
    | ((paneId: string, fromIdx: number, toIdx: number) => void)
    | undefined = undefined;
  export let onRelaunchHarness:
    | ((paneId: string, surfaceId: string) => void)
    | undefined = undefined;
  export let worktreePath: string | undefined = undefined;
  export let baseBranch: string | undefined = undefined;
  export let onNewContextualSurface:
    | ((paneId: string, kind: string) => void)
    | undefined = undefined;

  let dragging = false;

  function startDrag(e: MouseEvent) {
    if (node.type !== "split") return;
    e.preventDefault();
    dragging = true;

    const isVertical = node.direction === "vertical";
    const container = (e.target as HTMLElement).parentElement!;
    const rect = container.getBoundingClientRect();

    function onMove(ev: MouseEvent) {
      if (node.type !== "split") return;
      const pos = isVertical
        ? (ev.clientY - rect.top) / rect.height
        : (ev.clientX - rect.left) / rect.width;
      node.ratio = Math.max(0.1, Math.min(0.9, pos));
    }

    function onUp() {
      dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleDividerDblClick() {
    if (node.type === "split") {
      node.ratio = 0.5;
    }
  }
</script>

{#if node.type === "pane"}
  <PaneView
    pane={node.pane}
    isFocused={workspace.activePaneId === node.pane.id}
    onSelectSurface={(sid) => onSelectSurface(node.pane.id, sid)}
    onCloseSurface={(sid) => onCloseSurface(node.pane.id, sid)}
    onNewSurface={() => onNewSurface(node.pane.id)}
    onNewHarnessSurface={onNewHarnessSurface
      ? (pid) => onNewHarnessSurface!(node.pane.id, pid)
      : undefined}
    onSwitchSurface={onSwitchSurface
      ? (kind, pid) => onSwitchSurface!(node.pane.id, kind, pid)
      : undefined}
    onSplitRight={() => onSplitRight(node.pane.id)}
    onSplitDown={() => onSplitDown(node.pane.id)}
    onClosePane={() => onClosePane(node.pane.id)}
    onFocusPane={() => onFocusPane(node.pane.id)}
    onRenameTab={onRenameTab
      ? (sid, t) => onRenameTab!(node.pane.id, sid, t)
      : undefined}
    onReorderTab={onReorderTab
      ? (from, to) => onReorderTab!(node.pane.id, from, to)
      : undefined}
    onRelaunchHarness={onRelaunchHarness
      ? (sid) => onRelaunchHarness!(node.pane.id, sid)
      : undefined}
    {worktreePath}
    onNewContextualSurface={onNewContextualSurface
      ? (kind) => onNewContextualSurface!(node.pane.id, kind)
      : undefined}
  />
{:else}
  <div
    style="
    display: flex; flex: 1; min-width: 0; min-height: 0; gap: 0;
    flex-direction: {node.direction === 'vertical' ? 'column' : 'row'};
  "
  >
    <div
      style="flex: {node.ratio}; display: flex; min-width: 0; min-height: 0;"
    >
      <SplitNodeView
        node={node.children[0]}
        {workspace}
        {onSelectSurface}
        {onCloseSurface}
        {onNewSurface}
        {onNewHarnessSurface}
        {onSwitchSurface}
        {onSplitRight}
        {onSplitDown}
        {onClosePane}
        {onFocusPane}
        {onRenameTab}
        {onReorderTab}
        {onRelaunchHarness}
        {worktreePath}
        {baseBranch}
        {onNewContextualSurface}
      />
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
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
      on:mousedown={startDrag}
      on:dblclick={handleDividerDblClick}
    ></div>
    <div
      style="flex: {1 -
        node.ratio}; display: flex; min-width: 0; min-height: 0;"
    >
      <SplitNodeView
        node={node.children[1]}
        {workspace}
        {onSelectSurface}
        {onCloseSurface}
        {onNewSurface}
        {onNewHarnessSurface}
        {onSwitchSurface}
        {onSplitRight}
        {onSplitDown}
        {onClosePane}
        {onFocusPane}
        {onRenameTab}
        {onReorderTab}
        {onRelaunchHarness}
        {worktreePath}
        {baseBranch}
        {onNewContextualSurface}
      />
    </div>
  </div>
{/if}

<style>
  .split-divider:hover {
    filter: brightness(1.3);
  }
</style>
