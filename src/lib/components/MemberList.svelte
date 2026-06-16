<script lang="ts">
  /**
   * MemberList — the nested list of member (child) workspaces rendered
   * inside a group's anchor row when expanded. Owns its own
   * drag-to-reorder pipeline (members reorder within the group only) and
   * renders each member via WorkspaceRow.
   *
   * Ported + simplified from dev's WorkspaceListView: `dashboardHintFor`,
   * `hideStatusBadges`, the dashboard entry filter, the global-surface
   * accent lookup (`dropAccent = railColor`), and pane-drop detection are
   * all dropped. Reordering routes through `reorderMembers` so a member
   * drag only re-sorts its own group.
   */
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import { theme } from "../stores/theme";
  import { contextMenu } from "../stores/ui";
  import { createDragReorder, type DragReorderState } from "../actions/drag-reorder";
  import {
    switchWorkspace,
    closeWorkspace,
    renameWorkspace,
    reorderMembers,
  } from "../services/workspace-service";
  import type { MenuItem } from "../context-menu-types";
  import WorkspaceRow from "./WorkspaceRow.svelte";
  import DropGhost from "./DropGhost.svelte";

  /** Ordered member workspace ids (the anchor's `memberWorkspaceIds`). */
  export let memberIds: string[];
  /** The owning group's anchor id. */
  export let groupId: string;
  /** Rail/accent color inherited from the anchor. */
  export let accentColor: string | undefined = undefined;

  // Resolve member ids → { workspace, globalIdx } preserving member order.
  $: members = memberIds
    .map((id) => {
      const globalIdx = $workspaces.findIndex((w) => w.id === id);
      return globalIdx >= 0 ? { ws: $workspaces[globalIdx], globalIdx } : null;
    })
    .filter((m): m is { ws: (typeof $workspaces)[number]; globalIdx: number } => m !== null);

  let drag: DragReorderState = {
    sourceIdx: null,
    indicator: null,
    active: false,
    sourceHeight: 0,
  };
  $: railColor = accentColor ?? $theme.accent;

  const reorder = createDragReorder({
    dataAttr: "member-drag-idx",
    containerSelector: `[data-workspace-group-members="${groupId}"]`,
    ghostStyle: () => ({
      background: "transparent",
      border: `1px solid ${$theme.border ?? "transparent"}`,
    }),
    // `from`/`to` are member-list positions (data-member-drag-idx).
    onDrop: (from, to) => reorderMembers(groupId, from, to),
    onStateChange: () => {
      drag = reorder.getState();
    },
  });

  function startDrag(e: MouseEvent, memberPos: number) {
    const ws = members[memberPos]?.ws;
    if (ws?.locked === true) return;
    reorder.start(e, memberPos);
  }

  $: sourceWs =
    drag.active && drag.sourceIdx !== null
      ? (members[drag.sourceIdx]?.ws ?? null)
      : null;
  $: showGhostBefore = (pos: number) =>
    drag.active && drag.indicator?.idx === pos && drag.indicator?.edge === "before";
  $: showGhostAfter = (pos: number) =>
    drag.active && drag.indicator?.idx === pos && drag.indicator?.edge === "after";

  function showMemberContextMenu(x: number, y: number, globalIdx: number, wsId: string) {
    const items: MenuItem[] = [
      { label: "Rename Workspace", shortcut: "⇧⌘R", action: () => itemRefs[wsId]?.startRename() },
      { label: "", action: () => {}, separator: true },
      {
        label: "Close Workspace",
        shortcut: "⇧⌘W",
        danger: true,
        disabled: $workspaces.length <= 1,
        action: () => closeWorkspace(globalIdx),
      },
    ];
    contextMenu.set({ x, y, items });
  }

  let itemRefs: Record<string, WorkspaceRow> = {};
</script>

{#if members.length > 0}
  <div class="member-list" data-workspace-group-members={groupId}>
    {#each members as member, pos (member.ws.id)}
      <div class="member-list-row" data-member-drag-idx={pos}>
        {#if showGhostBefore(pos)}
          <DropGhost height={drag.sourceHeight} inset={4} accent={railColor} label={sourceWs?.name} />
        {/if}
        <WorkspaceRow
          bind:this={itemRefs[member.ws.id]}
          workspace={member.ws}
          index={member.globalIdx}
          isActive={member.globalIdx === $activeWorkspaceIdx}
          accentColor={railColor}
          dragActive={drag.sourceIdx === pos}
          onSelect={() => {
            if (!drag.active) switchWorkspace(member.globalIdx);
          }}
          onClose={() => closeWorkspace(member.globalIdx)}
          onRename={(name) => renameWorkspace(member.globalIdx, name)}
          onContextMenu={(x, y) => showMemberContextMenu(x, y, member.globalIdx, member.ws.id)}
          onGripMouseDown={(e) => startDrag(e, pos)}
        />
        {#if showGhostAfter(pos)}
          <DropGhost height={drag.sourceHeight} inset={4} accent={railColor} label={sourceWs?.name} />
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .member-list-row + .member-list-row {
    margin-top: 8px;
  }
  /* 8px left + top inset so member rails sit inset from the anchor's
     rail and the first member breathes below the anchor bar. */
  .member-list {
    margin-left: 8px;
    margin-top: 8px;
  }
</style>
