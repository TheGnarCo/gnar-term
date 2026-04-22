<script lang="ts">
  import type { Workspace } from "../types";
  import SplitNodeView from "./SplitNodeView.svelte";

  export let workspace: Workspace;
  export let visible: boolean;
  export let onSelectSurface: (paneId: string, surfaceId: string) => void;
  export let onCloseSurface: (paneId: string, surfaceId: string) => void;
  export let onNewSurface: (paneId: string) => void;
  export let onSplitRight: (paneId: string) => void;
  export let onSplitDown: (paneId: string) => void;
  export let onClosePane: (paneId: string) => void;
  export let onFocusPane: (paneId: string) => void;
  export let onReorderTab: ((paneId: string, fromIdx: number, toIdx: number) => void) | undefined = undefined;
</script>

<div style="flex: 1; display: flex; min-height: 0; min-width: 0; {visible ? '' : 'display: none;'}">
  <SplitNodeView
    node={workspace.splitRoot}
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
