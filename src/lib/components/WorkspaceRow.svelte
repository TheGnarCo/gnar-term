<script lang="ts">
  /**
   * WorkspaceRow — a single member (child) workspace row inside a group's
   * nested member list. Renders the SidebarElement shell with inline
   * rename, an unread/meta subtitle, and the latest notification line.
   *
   * Ported + simplified from dev's WorkspaceItem: `kind="child"` only;
   * worktree icon/status, bot icon, dashboard hint, branch-lifecycle,
   * path-missing subtitle, and the extension subtitle registry are all
   * dropped (out of scope).
   */
  import { tick } from "svelte";
  import { theme } from "../stores/theme";
  import type { Workspace } from "../types";
  import { getAllPanes, getAllSurfaces } from "../types";
  import SidebarElement from "./SidebarElement.svelte";
  import SidebarSubtitleRow from "./SidebarSubtitleRow.svelte";

  export let workspace: Workspace;
  /** Global index into the `workspaces` store — used by the callbacks. */
  export let index: number;
  export let isActive: boolean;
  export let onSelect: () => void;
  export let onClose: () => void;
  export let onRename: (name: string) => void;
  export let onContextMenu: (x: number, y: number) => void;
  /** Accent color inherited from the group's anchor (rail color). */
  export let accentColor: string | undefined = undefined;
  /** mousedown handler that arms the drag-reorder engine (owned by MemberList). */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /** When true the row is the active drag source — hidden in place. */
  export let dragActive: boolean = false;

  let nameEl: HTMLSpanElement;
  let renaming = false;

  $: allSurfaces = getAllSurfaces(workspace);
  $: hasUnread = allSurfaces.some((s) => s.hasUnread);
  $: paneCount = getAllPanes(workspace.splitRoot).length;
  $: surfaceCount = allSurfaces.length;
  $: latestNotification = allSurfaces.find(
    (s): s is Extract<typeof s, { notification?: string }> =>
      s.kind === "terminal" && !!s.notification,
  )?.notification;
  $: metaParts = [
    ...(paneCount > 1 ? [`${paneCount}p`] : []),
    ...(surfaceCount > 1 ? [`${surfaceCount}s`] : []),
  ];
  $: isLocked = workspace.locked === true;
  $: railColor = workspace.color ?? accentColor ?? $theme.accent;

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
    if (newName && newName !== workspace.name) {
      onRename(newName);
    } else {
      nameEl.textContent = workspace.name;
    }
    renaming = false;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<SidebarElement
  kind="child"
  compact
  name={workspace.name}
  {isActive}
  {isLocked}
  isDragging={dragActive}
  canDrag={!isLocked}
  canClose={true}
  color={railColor}
  dataWorkspaceId={workspace.id}
  dataDragIdx={index}
  onRailClick={() => onSelect()}
  onGripMouseDown={(e) => {
    if (!renaming) onGripMouseDown?.(e);
  }}
  onClose={() => onClose()}
  onContextMenu={(e) => onContextMenu(e.clientX, e.clientY)}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    role="presentation"
    style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 4px 0;"
    on:click={() => {
      if (!renaming) onSelect();
    }}
  >
    <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        bind:this={nameEl}
        role="textbox"
        tabindex="-1"
        style="
          font-weight: {isActive ? '600' : '400'};
          color: {isActive ? $theme.fg : $theme.fgMuted};
          font-size: 13px; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap; flex: 1;
          outline: none; padding: 2px 4px; margin-left: -4px; border-radius: 4px;
        "
        on:blur={finishRename}
        on:keydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            nameEl.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            nameEl.textContent = workspace.name;
            nameEl.blur();
          }
        }}
      >{workspace.name}</span>

      {#if metaParts.length > 0}
        <span
          style="font-size: 10px; color: {$theme.fgDim}; background: {$theme.bgSurface}; padding: 1px 5px; border-radius: 8px; flex-shrink: 0;"
        >
          {metaParts.join(" ")}
        </span>
      {/if}

      {#if hasUnread}
        <span
          style="width: 8px; height: 8px; border-radius: 50%; background: {$theme.notify}; flex-shrink: 0;"
        ></span>
      {/if}
    </div>

    {#if latestNotification}
      <SidebarSubtitleRow color={$theme.notify}>
        <span
          style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >{latestNotification}</span
        >
      </SidebarSubtitleRow>
    {/if}
  </div>
</SidebarElement>
