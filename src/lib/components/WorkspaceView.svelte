<script lang="ts">
  import type { Workspace } from "../types";
  import SplitNodeView from "./SplitNodeView.svelte";

  export let workspace: Workspace;
  export let visible: boolean;
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
</script>

<div
  style="flex: 1; display: flex; min-height: 0; min-width: 0; {visible
    ? ''
    : 'display: none;'}"
>
  <SplitNodeView
    node={workspace.splitRoot}
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
