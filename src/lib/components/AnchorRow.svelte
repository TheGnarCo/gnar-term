<script lang="ts">
  /**
   * AnchorRow — anchor-row chrome for a workspace group in the primary
   * sidebar. The anchor's row IS the group header (no separate header).
   * This component owns the whole group block: the full-height drag rail
   * (left) + the visible anchor bar + the nested member list (when
   * expanded).
   *
   * The visible bar is inert — callers wire activation through the rail
   * click / context menu / slot content. The nested-variant, dashboard
   * counts, and bot-status machinery from the source are dropped.
   * Slots/attrs/props follow TERMINOLOGY §2a (anchor-end / anchor-subtitle
   * / btn-row, data-workspace-group, data-anchor-row, onAnchorClick).
   */
  import { slide } from "svelte/transition";
  import { theme } from "../stores/theme";
  import SidebarRail from "./SidebarRail.svelte";

  /** Anchor + rail color. Required. */
  export let color: string;
  /** Group identity = the anchor workspace id. */
  export let groupId: string;
  /** Number of members in this group. Drives the collapse chevron. */
  export let memberCount: number = 0;
  /** Whether the member block is collapsed. */
  export let collapsed: boolean = true;
  /** Toggle the collapsed state. */
  export let toggle: (() => void) | undefined = undefined;
  /** True when the anchor itself is the active workspace. */
  export let isAnchorActive: boolean = false;
  /** True when any member of this group is the active workspace. */
  export let hasActiveMember: boolean = false;
  /** Grip mousedown — forwarded from the root drag pipeline. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /** Anchor body left-click — activates the anchor workspace. */
  export let onAnchorClick: (() => void) | undefined = undefined;
  /** Anchor body right-click. */
  export let onAnchorContextMenu: ((e: MouseEvent) => void) | undefined = undefined;
  /** Optional close/delete handler. */
  export let onClose: (() => void) | undefined = undefined;
  /** When true, shows a lock chip on the rail instead of the close button. */
  export let locked: boolean = false;
  /** True while this anchor's collapsed-mode popover is open. */
  export let popoverActive: boolean = false;

  let anchorHovered = false;

  $: expandable = memberCount > 0;
  $: hasMembers = !collapsed && expandable;

  function handleWrapperClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest("[data-sidebar-rail]")) return;
    if (t.closest("[data-sidebar-element]")) return;
    onAnchorClick?.();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-workspace-group={groupId}
  data-workspace-group-mode="anchor"
  style="display: flex; position: relative; align-items: stretch; cursor: pointer;"
  on:click|stopPropagation={handleWrapperClick}
>
  <SidebarRail
    mode="group"
    {color}
    canDrag={true}
    {locked}
    hasActiveStripe={hasActiveMember && collapsed}
    isActive={isAnchorActive || hasActiveMember}
    {popoverActive}
    {onGripMouseDown}
    onClick={onAnchorClick}
    {onClose}
    closeTooltip="Delete Workspace"
  />
  <div style="flex: 1; min-width: 0;">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      data-anchor-row
      style="
        position: relative;
        padding: 4px 6px 4px 0;
        min-height: 40px;
        margin-right: 4px;
        background: {anchorHovered
        ? ($theme.bgHighlight ?? 'transparent')
        : ($theme.bgSurface ?? 'transparent')};
        color: {$theme.fg};
        border-top: 1px solid {isAnchorActive ? color : ($theme.border ?? 'transparent')};
        border-right: 1px solid {isAnchorActive ? color : ($theme.border ?? 'transparent')};
        border-bottom: 1px solid {isAnchorActive ? color : ($theme.border ?? 'transparent')};
        border-left: none;
        border-radius: 0 6px 6px 0;
        cursor: pointer;
        transition: background 0.15s;
      "
      on:contextmenu={onAnchorContextMenu}
      on:mouseenter={() => (anchorHovered = true)}
      on:mouseleave={() => (anchorHovered = false)}
    >
      <div
        data-anchor-row-body
        style="padding-left: 8px; padding-right: 0; display: flex; flex-direction: column; gap: 2px; min-height: 32px; justify-content: center;"
      >
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <slot {anchorHovered} />
          <slot name="anchor-end" {anchorHovered} {collapsed} />
        </div>
        <div style="display: flex; align-items: flex-end; gap: 6px; min-width: 0;">
          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
            <slot name="anchor-subtitle" {anchorHovered} {collapsed} />
          </div>
          {#if expandable}
            <div class="anchor-row-btn-row">
              <button
                class="collapse-chevron"
                title={collapsed ? "Expand Group" : "Collapse Group"}
                aria-label={collapsed ? "Expand Group" : "Collapse Group"}
                aria-expanded={!collapsed}
                style="color: {$theme.fgDim};"
                on:click|stopPropagation={() => toggle?.()}
              >
                <span style="display: inline-block; transition: transform 0.15s; transform: rotate({collapsed ? 0 : 90}deg);"
                  >▶</span
                >
                <span style="font-size: 10px;">{memberCount}</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
    {#if hasMembers}
      <div
        data-workspace-group-members={groupId}
        data-members-count={memberCount}
        style="
          display: flex; flex-direction: column;
          margin: 0 4px 0 0;
          padding: 2px 0;
          border-radius: 6px;
        "
        transition:slide={{ duration: 200 }}
      >
        <slot name="members" />
      </div>
    {/if}
  </div>
</div>

<style>
  .anchor-row-btn-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .collapse-chevron {
    display: flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    font-size: 9px;
    line-height: 1;
    -webkit-app-region: no-drag;
  }
  .collapse-chevron:hover {
    filter: brightness(1.3);
  }
</style>
