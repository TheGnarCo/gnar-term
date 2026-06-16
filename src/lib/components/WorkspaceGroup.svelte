<script lang="ts">
  /**
   * WorkspaceGroup — wires an anchor `Workspace` into the AnchorRow
   * chrome: resolves the anchor color, renders the anchor name with
   * inline rename, computes the member id set + active/has-active-member
   * state, drives the collapse chevron from `groupCollapsedState`, and
   * renders the nested MemberList.
   *
   * Renamed + HARD-simplified from dev's WorkspaceSectionContent: the
   * dashboards / tile-actions / chips, bot-status pipeline,
   * after-children contributors, extension subtitle registry, and BotIcon
   * are all dropped. A standalone workspace (no members) renders as a
   * degenerate group — anchor bar only, no chevron, no member block.
   */
  import { tick } from "svelte";
  import { theme } from "../stores/theme";
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import { groupCollapsedState, setGroupCollapsed, contextMenu } from "../stores/ui";
  import {
    switchWorkspace,
    closeWorkspace,
    renameWorkspace,
    updateWorkspace,
  } from "../services/workspace-service";
  import type { Workspace } from "../types";
  import type { MenuItem } from "../context-menu-types";
  import AnchorRow from "./AnchorRow.svelte";
  import MemberList from "./MemberList.svelte";

  /** The anchor workspace this group is built around. */
  export let anchor: Workspace;
  /** Grip mousedown — forwarded from the root drag pipeline. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /** True while this group's collapsed-mode popover is open. */
  export let popoverActive: boolean = false;

  let nameEl: HTMLSpanElement;
  let renaming = false;

  $: anchorColor = anchor.color ?? $theme.accent;
  $: anchorIdx = $workspaces.findIndex((w) => w.id === anchor.id);
  $: isAnchorActive = anchorIdx >= 0 && anchorIdx === $activeWorkspaceIdx;

  // Membership is derived from the tag; member ORDER comes from the
  // anchor's memberWorkspaceIds, filtered to ids that still exist.
  $: memberIds = (anchor.memberWorkspaceIds ?? []).filter((id) =>
    $workspaces.some((w) => w.id === id && w.anchorWorkspaceId === anchor.id),
  );
  $: memberCount = memberIds.length;
  $: hasActiveMember =
    $activeWorkspaceIdx >= 0 &&
    memberIds.includes($workspaces[$activeWorkspaceIdx]?.id ?? "");

  // Default collapsed for a fresh group; an explicit `false` keeps it open.
  $: collapsed = $groupCollapsedState.get(anchor.id) ?? true;
  function toggle() {
    setGroupCollapsed(anchor.id, !collapsed);
  }

  $: isLocked = anchor.locked === true;

  export async function startRename() {
    renaming = true;
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
    if (newName && newName !== anchor.name && anchorIdx >= 0) {
      renameWorkspace(anchorIdx, newName);
    } else {
      nameEl.textContent = anchor.name;
    }
    renaming = false;
  }

  function activate() {
    if (renaming) return;
    if (anchorIdx >= 0) switchWorkspace(anchorIdx);
  }

  function showContextMenu(e: MouseEvent) {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: "Rename Workspace", shortcut: "⇧⌘R", action: () => startRename() },
      {
        label: isLocked ? "Unlock Workspace" : "Lock Workspace",
        action: () => updateWorkspace(anchor.id, { locked: !isLocked }),
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "Close Workspace",
        shortcut: "⇧⌘W",
        danger: true,
        disabled: $workspaces.length <= 1 || isLocked,
        action: () => {
          if (anchorIdx >= 0) closeWorkspace(anchorIdx);
        },
      },
    ];
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }
</script>

<AnchorRow
  color={anchorColor}
  groupId={anchor.id}
  {memberCount}
  {collapsed}
  {toggle}
  {isAnchorActive}
  {hasActiveMember}
  {popoverActive}
  locked={isLocked}
  {onGripMouseDown}
  onAnchorClick={activate}
  onAnchorContextMenu={showContextMenu}
  onClose={() => {
    if (anchorIdx >= 0) closeWorkspace(anchorIdx);
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    bind:this={nameEl}
    role="textbox"
    tabindex="-1"
    style="
      font-weight: {isAnchorActive ? '600' : '500'};
      color: {isAnchorActive ? $theme.fg : $theme.fgMuted};
      font-size: 13px; overflow: hidden; flex: 1;
      text-overflow: ellipsis; white-space: nowrap;
      outline: none; padding: 2px 4px; margin-left: -4px; border-radius: 4px;
    "
    on:click={activate}
    on:blur={finishRename}
    on:keydown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        nameEl.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        nameEl.textContent = anchor.name;
        nameEl.blur();
      }
    }}
  >{anchor.name}</span>

  <svelte:fragment slot="members">
    <MemberList {memberIds} groupId={anchor.id} accentColor={anchorColor} />
  </svelte:fragment>
</AnchorRow>
