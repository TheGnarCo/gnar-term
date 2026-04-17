<script lang="ts">
  import { flip } from "svelte/animate";
  import type { Readable } from "svelte/store";
  import { theme } from "../stores/theme";
  import { activeWorkspaceIdx } from "../stores/workspace";
  import { contextMenu } from "../stores/ui";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import SplitButton from "./SplitButton.svelte";
  import type { SplitButtonItem } from "./SplitButton.svelte";
  import type { MenuItem } from "../context-menu-types";
  import type { Workspace } from "../types";
  import type { WorkspaceAction } from "../services/workspace-action-registry";

  export let unclaimedEntries: Array<{ ws: Workspace; idx: number }>;
  export let coreAction: WorkspaceAction | undefined;
  export let splitDropdownItems: SplitButtonItem[];
  export let insertIndicator: { idx: number; edge: "before" | "after" } | null;
  export let dragActive: boolean;
  export let dragSourceIdx: number | null;

  export let suppressNewButton = false;

  export let onStartDrag: (e: MouseEvent, idx: number) => void;
  export let onSwitchWorkspace: (idx: number) => void;
  export let onCloseWorkspace: (idx: number) => void;
  export let onRenameWorkspace: (idx: number, name: string) => void;
  export let onNewSurface: () => void;

  let workspaceItems: Record<string, WorkspaceItem> = {};

  export function startRename(idx: number) {
    const ws = unclaimedEntries.find((e) => e.idx === idx)?.ws;
    const item = ws ? workspaceItems[ws.id] : undefined;
    if (item) {
      item.startRename();
    }
  }

  function showWorkspaceContextMenu(x: number, y: number, idx: number) {
    const items: MenuItem[] = [
      {
        label: "Rename Workspace",
        shortcut: "⇧⌘R",
        action: () => startRename(idx),
      },
      {
        label: "New Surface",
        shortcut: "⌘T",
        action: () => {
          onSwitchWorkspace(idx);
          onNewSurface();
        },
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "Close Other Workspaces",
        disabled: unclaimedEntries.length <= 1,
        action: () => {
          for (let i = unclaimedEntries.length - 1; i >= 0; i--) {
            const entry = unclaimedEntries[i];
            if (entry && entry.idx !== idx) onCloseWorkspace(entry.idx);
          }
        },
      },
      {
        label: "Close Workspace",
        shortcut: "⇧⌘W",
        danger: true,
        disabled: unclaimedEntries.length <= 1,
        action: () => onCloseWorkspace(idx),
      },
    ];
    contextMenu.set({ x, y, items });
  }
</script>

{#if coreAction && !suppressNewButton}
  <div style="padding: 4px 8px;">
    <SplitButton
      label="New Workspace"
      onMainClick={() => coreAction?.handler({})}
      dropdownItems={splitDropdownItems}
      theme={theme as unknown as Readable<Record<string, string>>}
      fullWidth={true}
    />
  </div>
{/if}
{#each unclaimedEntries as entry, _i (entry.ws.id)}
  {@const ws = entry.ws}
  {@const idx = entry.idx}
  <div animate:flip={{ duration: 200 }}>
    {#if insertIndicator?.idx === idx && insertIndicator.edge === "before"}
      <div
        style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
      ></div>
    {/if}
    <WorkspaceItem
      bind:this={workspaceItems[ws.id]}
      workspace={ws}
      index={idx}
      isActive={idx === $activeWorkspaceIdx}
      dragActive={dragActive && dragSourceIdx === idx}
      onSelect={() => {
        if (!dragActive) onSwitchWorkspace(idx);
      }}
      onClose={() => onCloseWorkspace(idx)}
      onRename={(name) => onRenameWorkspace(idx, name)}
      onContextMenu={(x, y) => showWorkspaceContextMenu(x, y, idx)}
      onGripMouseDown={(e) => onStartDrag(e, idx)}
    />
    {#if insertIndicator?.idx === idx && insertIndicator.edge === "after"}
      <div
        style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
      ></div>
    {/if}
  </div>
{/each}
