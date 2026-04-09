<script lang="ts">
  import { theme } from "../stores/theme";
  import { contextMenu } from "../stores/ui";
  import { getSettings } from "../settings";
  import Tab from "./Tab.svelte";
  import type { Pane } from "../types";
  import type { MenuItem } from "../context-menu-types";

  export let pane: Pane;
  export let onSelectSurface: (surfaceId: string) => void;
  export let onCloseSurface: (surfaceId: string) => void;
  export let onNewSurface: () => void;
  export let onNewHarnessSurface: ((presetId: string) => void) | undefined =
    undefined;
  export let onSwitchSurface:
    | ((kind: string, presetId?: string) => void)
    | undefined = undefined;
  export let onSplitRight: () => void;
  export let onSplitDown: () => void;
  export let onClosePane: () => void;
  export let onRenameTab:
    | ((surfaceId: string, newTitle: string) => void)
    | undefined = undefined;
  export let onReorderTab:
    | ((fromIdx: number, toIdx: number) => void)
    | undefined = undefined;
  export let worktreePath: string | undefined = undefined;
  export let onNewContextualSurface: ((kind: string) => void) | undefined =
    undefined;

  function showNewSurfaceMenu(e: MouseEvent) {
    const items: MenuItem[] = [{ label: "Terminal", action: onNewSurface }];
    const settings = getSettings();
    items.push({
      label: "Harness",
      action: () =>
        onNewHarnessSurface?.(
          settings.defaultHarness || settings.harnesses[0]?.id || "claude",
        ),
      disabled: !onNewHarnessSurface,
    });
    if (worktreePath) {
      items.push(
        { label: "", action: () => {}, separator: true },
        { label: "Diff", action: () => onNewContextualSurface?.("diff") },
        {
          label: "Files",
          action: () => onNewContextualSurface?.("filebrowser"),
        },
        {
          label: "Commits",
          action: () => onNewContextualSurface?.("commithistory"),
        },
      );
    }
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }

  function showSwitchSurfaceMenu(e: MouseEvent) {
    const items: MenuItem[] = [
      { label: "Terminal", action: () => onSwitchSurface?.("terminal") },
    ];
    const settings = getSettings();
    items.push({
      label: "Harness",
      action: () =>
        onSwitchSurface?.(
          "harness",
          settings.defaultHarness || settings.harnesses[0]?.id || "claude",
        ),
    });
    if (worktreePath) {
      items.push(
        { label: "", action: () => {}, separator: true },
        { label: "Diff", action: () => onSwitchSurface?.("diff") },
        { label: "Files", action: () => onSwitchSurface?.("filebrowser") },
        { label: "Commits", action: () => onSwitchSurface?.("commithistory") },
      );
    }
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }
</script>

<div
  style="
    display: flex; align-items: center; gap: 1px;
    background: {$theme.tabBarBg}; border-bottom: none;
    height: 28px; padding: 0 4px; flex-shrink: 0; overflow-x: auto;
    scrollbar-width: none;
  "
>
  {#each pane.surfaces as surface, i (surface.id)}
    <Tab
      {surface}
      index={i}
      isActive={surface.id === pane.activeSurfaceId}
      onSelect={() => onSelectSurface(surface.id)}
      onClose={() => onCloseSurface(surface.id)}
      onRename={onRenameTab ? (t) => onRenameTab!(surface.id, t) : undefined}
      onReorder={onReorderTab}
    />
  {/each}

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    title="New surface"
    style="color: {$theme.fgDim}; cursor: pointer; font-size: 14px; padding: 0 6px;"
    on:click={showNewSurfaceMenu}>+</span
  >

  <div style="flex: 1;"></div>

  <div
    style="display: flex; align-items: center; gap: 2px; padding-right: 2px;"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Split Right (⌘D)"
      style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onSplitRight}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        ><rect x="1" y="1" width="12" height="12" rx="1" /><line
          x1="7"
          y1="1"
          x2="7"
          y2="13"
        /></svg
      >
    </span>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Split Down (⇧⌘D)"
      style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onSplitDown}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        ><rect x="1" y="1" width="12" height="12" rx="1" /><line
          x1="1"
          y1="7"
          x2="13"
          y2="7"
        /></svg
      >
    </span>
    {#if onSwitchSurface}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        title="Switch surface type"
        style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
        on:click|stopPropagation={showSwitchSurfaceMenu}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          ><path d="M4 2l-3 3 3 3" /><path d="M10 6l3 3-3 3" /><line
            x1="1"
            y1="5"
            x2="10"
            y2="5"
          /><line x1="4" y1="9" x2="13" y2="9" /></svg
        >
      </span>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Close Pane"
      style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onClosePane}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        ><line x1="2" y1="2" x2="10" y2="10" /><line
          x1="10"
          y1="2"
          x2="2"
          y2="10"
        /></svg
      >
    </span>
  </div>
</div>
