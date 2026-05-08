<script lang="ts">
  /**
   * SidebarBanner — root-row chrome for a Workspace banner in the
   * primary sidebar. Per `docs/ontology.md`, a "banner" is the sidebar
   * block rendered for a `kind: "workspace"` entry in `rootRowOrder`,
   * showing the Root Workspace's name, color, git status, and its
   * nested Branch list. This component owns that whole block —
   * grip + visible bar + nested list — and is the unit reused for
   * banners hosted inside other banners (e.g. an Agentic Dashboard
   * row inside its Workspace banner).
   *
   * The visible bar is **inert**: callers cannot register a click
   * handler on it directly. Interaction lives in the child rows
   * inside the nested list (e.g. the Dashboard workspace item) or
   * in the context menu. Internal buttons and links in `banner-end`
   * stop their own propagation.
   *
   * Visual variants:
   *   - `parentColor` unset → root mode: grip + bar + nested list
   *     stretch together with the shared rail color.
   *   - `parentColor` set → nested-inside-another-banner mode: bar
   *     only, no outer grip, with the host banner's color painting
   *     the bar background and a small accent strip on the right.
   */
  import { type Component } from "svelte";
  import { slide } from "svelte/transition";
  import { theme } from "../stores/theme";
  import { workspaces } from "../stores/workspace";
  import {
    bannerCollapsedState,
    setBannerCollapsed,
    sidebarVisible,
  } from "../stores/ui";
  import SidebarElement from "./SidebarElement.svelte";
  import SidebarRail from "./SidebarRail.svelte";
  import DefaultWorkspaceListView from "./WorkspaceListView.svelte";
  import type { Workspace } from "../types";

  /** Banner + rail color. Required. */
  export let color: string;
  /**
   * When set, render the nested variant: bar only (no grip), painted
   * with `color` as background. Used when this banner is nested
   * inside another banner (e.g. a dashboard under a Workspace).
   */
  export let parentColor: string | undefined = undefined;
  /**
   * Grip handle mousedown — forwarded from core's createDragReorder.
   * In nested variant (parentColor set) the grip is not rendered.
   */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /** Banner body right-click — ignored if undefined. */
  export let onBannerContextMenu: ((e: MouseEvent) => void) | undefined =
    undefined;
  /**
   * Banner body left-click — fires for clicks anywhere in the bar
   * (including the git-status subtitle area). Interactive children
   * inside the bar (SplitButton chips, PR/diff links) call
   * `stopPropagation` so they don't bubble into this handler.
   */
  export let onBannerClick: (() => void) | undefined = undefined;
  /** Optional close/delete handler. When provided, a × button appears on bar hover. */
  export let onClose: (() => void) | undefined = undefined;
  /** When true, shows a lock chip on the grip instead of the close button. */
  export let locked: boolean = false;

  /** Child workspace list filter — ids to include. */
  export let filterIds: Set<string>;
  /** Dashboard-hint resolver forwarded to WorkspaceListView. */
  export let dashboardHintFor:
    | ((
        ws: Workspace,
      ) => { id: string; color?: string; onClick: () => void } | undefined)
    | undefined = undefined;
  /** Forwarded: suppress per-row status badges when the banner aggregates. */
  export let hideStatusBadges: boolean = false;
  /**
   * When true, any descendant of this banner (the root workspace itself,
   * a branched workspace, or a dashboard child) is the active workspace.
   * Drives the rail's collapsed-mode width and the active-stripe accent
   * — both represent "this banner contains the active workspace".
   */
  export let hasActiveChild: boolean = false;
  /**
   * When true, the root workspace this banner represents is itself the
   * active workspace (not a child of it). Drives the bar's border stroke
   * — the border lights up only when the root is selected, not when a
   * child branch is, since branches own their own row chrome.
   */
  export let isPrimaryActive: boolean = false;
  /** Drag scope id (banner id). */
  export let scopeId: string;
  /** Sidebar block id the banner belongs to (for drag context). */
  export let containerBlockId: string = "__workspaces__";
  /** Human-readable label surfaced in the nested list's context menu. */
  export let containerLabel: string = "";
  /**
   * Optional data attribute for identifying the row in tests / DOM.
   * Defaults to `data-sidebar-banner` without a value.
   */
  export let testId: string | undefined = undefined;
  /**
   * Optional override for the child WorkspaceListView component. Used
   * only by tests so they can inject a stub that records props — in
   * production this defaults to the real component imported above.
   */
  export let workspaceListViewComponent: Component | unknown | undefined =
    undefined;
  /**
   * True while this banner's collapsed-mode popover is open. Forwarded
   * to the SidebarRail so the rail stays full-width while the popover
   * is being shown, even after the cursor has left the rail itself.
   */
  export let popoverActive: boolean = false;
  /**
   * Number of dashboard chips this banner will render in its
   * children-leading slot. Combined with `nonDashboardCount` it
   * determines whether the banner is expandable and whether the
   * children container renders. Default 0 keeps the legacy behavior
   * for callers that haven't migrated.
   */
  export let dashboardCount: number = 0;

  let bannerHovered = false;

  // Wrapper-level click for the banner body. The visible bar, the
  // banner-subtitle slots, and any empty space in the row should all
  // count as activating the workspace — especially in collapsed mode,
  // where the popover spans more area than the bar alone. Clicks that
  // originate inside a self-handling descendant (the rail, which fires
  // `onBannerClick` itself, or a nested SidebarElement row that owns
  // its own activation) are ignored so they don't double-fire.
  function handleWrapperClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest("[data-sidebar-rail]")) return;
    if (t.closest("[data-sidebar-element]")) return;
    onBannerClick?.();
  }

  // Non-dashboard count: dashboards don't count as real child workspaces for
  // the purposes of showing the toggle button and auto-expand/collapse.
  $: nonDashboardCount = $workspaces.filter(
    (ws) => filterIds.has(ws.id) && ws.isDashboard !== true,
  ).length;

  // Collapsed state is read from the shared `bannerCollapsedState`
  // store keyed by scopeId. This keeps the popover banner (rendered
  // over the terminal area when the sidebar is collapsed) and the
  // main-view banner (clipped behind the 12px rail strip) in sync —
  // toggling the chevron in the popover updates the rail height in
  // the strip the same way it updates inside an expanded sidebar.
  // Default is collapsed for fresh banners; the user's explicit
  // toggle is persisted via banner-collapse-persistence-service.
  $: collapsed = $bannerCollapsedState.get(scopeId) ?? true;
  function toggleCollapsed() {
    setBannerCollapsed(scopeId, !collapsed);
  }
  let prevExpandableCount = -1;
  $: expandableCount = nonDashboardCount + dashboardCount;
  $: expandable = expandableCount > 0;
  $: {
    const count = expandableCount;
    // Auto-expand only when an existing populated banner gains a child.
    // Skip the from-zero growth case so the count climbing from 0 to N
    // during initial workspace load doesn't override a persisted
    // collapsed flag. Auto-collapse when the banner empties out.
    if (prevExpandableCount > 0 && count > prevExpandableCount) {
      setBannerCollapsed(scopeId, false);
    } else if (prevExpandableCount > 0 && count === 0) {
      setBannerCollapsed(scopeId, true);
    }
    prevExpandableCount = count;
  }

  $: WorkspaceListViewResolved = (workspaceListViewComponent ??
    DefaultWorkspaceListView) as Component;
</script>

<!-- The banner sits flush with the viewport's left edge. When the
     cursor exits through that edge fast (or out the top into the title
     bar on Linux/WebKitGTK), the row's own `mouseleave` can be skipped,
     leaving the bar stuck in its hovered state. A body-level
     mouseleave is the authoritative "cursor left the app" signal —
     when it fires we know no DOM element should be considered hovered. -->
<svelte:body on:mouseleave={() => (bannerHovered = false)} />

{#if parentColor}
  <!-- Nested variant — bar only, with left-edge colored accent. Uses
       SidebarElement for unified styling. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-sidebar-banner={testId ?? ""}
    data-sidebar-banner-mode="child"
    style="position: relative;"
    on:click|stopPropagation={handleWrapperClick}
  >
    <SidebarElement
      kind="parent"
      name={containerLabel}
      isActive={isPrimaryActive}
      isLocked={locked}
      isDragging={false}
      canDrag={false}
      canClose={!!onClose}
      {color}
      {popoverActive}
      onRailClick={onBannerClick}
      {onClose}
      onContextMenu={onBannerContextMenu}
    >
      <div
        data-sidebar-banner-row-body
        style="padding: 4px 8px; display: flex; flex-direction: column; gap: 2px; min-height: 32px; justify-content: center; flex: 1; min-width: 0;"
      >
        <div
          style="display: flex; align-items: center; gap: 8px; min-width: 0;"
        >
          <slot name="icon" />
          <slot />
          <slot name="banner-end" />
        </div>
        <div
          style="display: flex; align-items: flex-end; gap: 6px; min-width: 0;"
        >
          <div
            style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;"
          >
            <slot name="banner-subtitle" {collapsed} />
          </div>
          {#if $$slots["btn-row"]}
            <div class="sidebar-banner-btn-row">
              <slot
                name="btn-row"
                {collapsed}
                toggle={toggleCollapsed}
                showToggle={expandable}
              />
            </div>
          {/if}
        </div>
      </div>
    </SidebarElement>
    {#if !collapsed && expandable}
      <div
        data-sidebar-banner-children={scopeId}
        data-children-count={nonDashboardCount}
        data-dashboard-count={dashboardCount}
        style="display: flex; flex-direction: column;"
        transition:slide={{ duration: 200 }}
      >
        <slot name="children-leading" />
        {#if nonDashboardCount > 0}
          <svelte:component
            this={WorkspaceListViewResolved}
            {filterIds}
            accentColor={color}
            {scopeId}
            {containerBlockId}
            {dashboardHintFor}
            {hideStatusBadges}
          />
        {/if}
      </div>
    {/if}
    <slot name="after-children" />
  </div>
{:else}
  <!-- Root variant — the colored grip column lives at the outer flex
       level so it stretches the full banner height (a continuous rail
       connecting the bar to the children). A light border (matching
       the inactive dashboard-tile stroke) wraps only the bar; the
       child workspace list renders below the border so children carry
       their own chrome. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-sidebar-banner={testId ?? ""}
    data-sidebar-banner-mode="root"
    style="display: flex; position: relative; align-items: stretch; cursor: pointer;"
    on:click|stopPropagation={handleWrapperClick}
  >
    {#if onGripMouseDown}
      <SidebarRail
        mode="container"
        {color}
        canDrag={true}
        {locked}
        hasActiveStripe={hasActiveChild && collapsed}
        isActive={hasActiveChild}
        {popoverActive}
        {onGripMouseDown}
        onClick={onBannerClick}
        {onClose}
        closeTooltip="Delete Workspace"
      />
    {/if}
    <div
      style="
        flex: 1;
        min-width: 0;
      "
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        data-sidebar-banner-row
        style="
          position: relative;
          padding: 4px 6px 4px 0;
          min-height: 40px;
          margin-right: 4px;
          background: {bannerHovered
          ? ($theme.bgHighlight ?? 'transparent')
          : ($theme.bgSurface ?? 'transparent')};
          color: {$theme.fg};
          border-top: 1px solid {isPrimaryActive
          ? color
          : ($theme.border ?? 'transparent')};
          border-right: 1px solid {isPrimaryActive
          ? color
          : ($theme.border ?? 'transparent')};
          border-bottom: 1px solid {isPrimaryActive
          ? color
          : ($theme.border ?? 'transparent')};
          border-left: none;
          border-radius: 0 6px 6px 0;
          cursor: pointer;
          transition: background 0.15s;
        "
        on:contextmenu={onBannerContextMenu}
        on:mouseenter={() => (bannerHovered = true)}
        on:mouseleave={() => (bannerHovered = false)}
      >
        <div
          data-sidebar-banner-row-body
          style="padding-left: 8px; padding-right: 0; display: flex; flex-direction: column; gap: 2px; min-height: 32px; justify-content: center;"
        >
          <div
            style="display: flex; align-items: center; gap: 8px; min-width: 0;"
          >
            <slot name="icon" {bannerHovered} />
            <slot {bannerHovered} />
            <slot name="banner-end" {bannerHovered} {collapsed} />
          </div>
          <div
            style="display: flex; align-items: flex-end; gap: 6px; min-width: 0;"
          >
            <div
              style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;"
            >
              <slot name="banner-subtitle" {bannerHovered} {collapsed} />
            </div>
            {#if $$slots["btn-row"]}
              <div class="sidebar-banner-btn-row">
                <slot
                  name="btn-row"
                  {collapsed}
                  toggle={toggleCollapsed}
                  showToggle={expandable}
                />
              </div>
            {/if}
          </div>
        </div>
      </div>
      {#if !collapsed && expandable}
        <div
          data-sidebar-banner-children={scopeId}
          data-children-count={nonDashboardCount}
          data-dashboard-count={dashboardCount}
          style="
            display: flex; flex-direction: column;
            {!$sidebarVisible
            ? `margin-right: 4px;
                 background: ${$theme.sidebarBg ?? $theme.bg ?? '#000'}cc;
                 backdrop-filter: blur(10px);
                 -webkit-backdrop-filter: blur(10px);
                 border-radius: 0 0 6px 0;`
            : 'margin-left: -2px; margin-top: -2px;'}
          "
          transition:slide={{ duration: 200 }}
        >
          <slot name="children-leading" />
          {#if nonDashboardCount > 0}
            <svelte:component
              this={WorkspaceListViewResolved}
              {filterIds}
              accentColor={color}
              {scopeId}
              {containerBlockId}
              {dashboardHintFor}
              {hideStatusBadges}
            />
          {/if}
        </div>
      {/if}
      <slot name="after-children" />
    </div>
  </div>
{/if}

<style>
  .sidebar-banner-btn-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  :global([data-sidebar-banner-mode="root"] button) {
    cursor: pointer;
  }
</style>
