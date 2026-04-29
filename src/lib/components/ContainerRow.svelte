<script lang="ts">
  /**
   * ContainerRow — shared root-row chrome for "container workspaces" in
   * the Workspaces sidebar section (projects, agent orchestrators).
   *
   * The banner is **inert**: callers cannot register a click handler.
   * Interaction lives in the child rows inside the nested list (e.g. the
   * Dashboard workspace item) or in the context menu. Internal buttons
   * and links in `banner-end` stop their own propagation.
   *
   * Visual variants:
   *   - `parentColor` unset → root mode: grip + banner + nested list
   *     stretch together with the shared rail color.
   *   - `parentColor` set → nested-inside-another-container mode: banner
   *     only, no outer grip, with the orchestrator/project color painting
   *     the banner background and a small accent strip on the right.
   */
  import { type Component } from "svelte";
  import { slide } from "svelte/transition";
  import { theme } from "../stores/theme";
  import { reorderContext } from "../stores/ui";
  import DragGrip from "./DragGrip.svelte";
  import DefaultWorkspaceListView from "./WorkspaceListView.svelte";
  import type { Workspace } from "../types";

  /** Banner + rail color. Required. */
  export let color: string;
  /**
   * When set, render the nested variant: banner only (no grip), painted
   * with `color` as background. Used when this container is nested
   * inside another container (e.g. a dashboard under a project).
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
   * Banner body left-click — fires for clicks anywhere in the banner
   * row (including the git-status subtitle area). Interactive children
   * inside the banner (SplitButton chips, PR/diff links) call
   * `stopPropagation` so they don't bubble into this handler.
   */
  export let onBannerClick: (() => void) | undefined = undefined;

  /** Nested workspace list filter — ids to include. */
  export let filterIds: Set<string>;
  /** Dashboard-hint resolver forwarded to WorkspaceListView. */
  export let dashboardHintFor:
    | ((
        ws: Workspace,
      ) => { id: string; color?: string; onClick: () => void } | undefined)
    | undefined = undefined;
  /** Forwarded: suppress per-row status badges when the container aggregates. */
  export let hideStatusBadges: boolean = false;
  /**
   * When true, a nested workspace inside this container is the active
   * workspace. The banner swaps its idle `$theme.border` stroke for the
   * container's `color` so the active state ties the group banner to
   * its active child visually.
   */
  export let hasActiveChild: boolean = false;
  /** Drag scope id (container id). */
  export let scopeId: string;
  /** Sidebar block id the container belongs to (for drag context). */
  export let containerBlockId: string = "__workspaces__";
  /** Human-readable label surfaced in the nested list's context menu. */
  export let containerLabel: string = "";
  /**
   * Optional data attribute for identifying the row in tests / DOM.
   * Defaults to `data-container-row` without a value.
   */
  export let testId: string | undefined = undefined;
  /**
   * Optional override for the nested WorkspaceListView component. Used
   * only by tests so they can inject a stub that records props — in
   * production this defaults to the real component imported above.
   */
  export let workspaceListViewComponent: Component | unknown | undefined =
    undefined;

  let bannerHovered = false;
  let mouseOverContainer = false;
  let containerLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  function handleContainerEnter() {
    if (containerLeaveTimer !== null) {
      clearTimeout(containerLeaveTimer);
      containerLeaveTimer = null;
    }
    mouseOverContainer = true;
  }

  function handleContainerLeave() {
    containerLeaveTimer = setTimeout(() => {
      mouseOverContainer = false;
      containerLeaveTimer = null;
    }, 80);
  }

  $: rowHovered = mouseOverContainer;
  $: railBorderColor =
    hasActiveChild && collapsed ? color : ($theme.border ?? "transparent");
  let collapsed = false;
  let prevFilterIds = filterIds;
  $: if (filterIds !== prevFilterIds) {
    if (filterIds.size > prevFilterIds.size && collapsed) collapsed = false;
    prevFilterIds = filterIds;
  }

  $: WorkspaceListViewResolved = (workspaceListViewComponent ??
    DefaultWorkspaceListView) as Component;
</script>

{#if parentColor}
  <!-- Nested-inside-parent variant — banner only, with a left-edge
       colored accent replacing the old full-bleed colored background. -->
  <div
    data-container-row={testId ?? ""}
    data-container-mode="nested"
    style="position: relative;"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      data-container-banner
      style="
        position: relative;
        margin: 0 8px 0 0;
        border-radius: 0 6px 6px 0;
        overflow: hidden;
        min-height: 40px;
        cursor: default;
        background: transparent;
        color: {$theme.fg};
        border-left: 3px solid {color};
      "
      on:contextmenu={onBannerContextMenu}
      on:mouseenter={() => (bannerHovered = true)}
      on:mouseleave={() => (bannerHovered = false)}
    >
      <div
        data-container-banner-body
        style="padding: 4px 8px; display: flex; flex-direction: column; gap: 2px; min-height: 32px; justify-content: center;"
      >
        <div
          style="display: flex; align-items: center; gap: 8px; min-width: 0;"
        >
          <slot name="icon" />
          <slot />
          <slot name="banner-end" />
        </div>
        <slot name="banner-subtitle" />
        {#if $$slots["btn-row"]}
          <div class="container-btn-row">
            <slot
              name="btn-row"
              {collapsed}
              toggle={() => (collapsed = !collapsed)}
            />
          </div>
        {/if}
      </div>
    </div>
    {#if !collapsed && filterIds.size > 0}
      <div
        data-container-nested={scopeId}
        data-nested-count={filterIds.size}
        style="display: flex; flex-direction: column;"
        transition:slide={{ duration: 200 }}
      >
        <svelte:component
          this={WorkspaceListViewResolved}
          {filterIds}
          accentColor={color}
          {scopeId}
          {containerBlockId}
          {containerLabel}
          {dashboardHintFor}
          {hideStatusBadges}
        />
      </div>
    {/if}
    <slot name="after-nested" />
  </div>
{:else}
  <!-- Root variant — the colored grip column lives at the outer flex
       level so it stretches the full group height (a continuous rail
       connecting the banner to the nested children). A light border
       (matching the inactive dashboard-tile stroke) wraps only the
       banner row; the nested workspace list renders below the border
       so children carry their own chrome. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-container-row={testId ?? ""}
    data-container-mode="root"
    style="display: flex; position: relative; align-items: stretch;"
  >
    {#if onGripMouseDown}
      <div
        data-container-rail
        on:mouseenter={handleContainerEnter}
        on:mouseleave={handleContainerLeave}
        on:mousedown={(e) => onGripMouseDown?.(e)}
        style="
          flex-shrink: 0;
          align-self: stretch;
          display: flex;
          position: relative;
          box-sizing: border-box;
          border-left: 1px solid {railBorderColor};
          border-top: 1px solid {railBorderColor};
          border-bottom: 1px solid {collapsed
          ? railBorderColor
          : 'transparent'};
        "
        role="presentation"
      >
        <DragGrip
          theme={$theme}
          visible={rowHovered && $reorderContext === null}
          railColor={color}
          railOpacity={1}
          alwaysShowDots={true}
          fadeRight={!rowHovered}
        />
        {#if hasActiveChild && collapsed}
          <div
            aria-hidden="true"
            style="
              position: absolute;
              top: 0; left: 0; bottom: 0;
              width: 1px;
              background: {color};
              pointer-events: none;
              z-index: 4;
            "
          ></div>
        {/if}
      </div>
    {/if}
    <div
      style="
        flex: 1;
        min-width: 0;
      "
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        data-container-banner
        style="
          position: relative;
          padding: 4px 6px;
          min-height: 40px;
          margin-right: 8px;
          background: {bannerHovered
          ? ($theme.bgHighlight ?? 'transparent')
          : ($theme.bgSurface ?? 'transparent')};
          color: {$theme.fg};
          border-top: 1px solid {hasActiveChild && collapsed
          ? color
          : ($theme.border ?? 'transparent')};
          border-right: 1px solid {hasActiveChild && collapsed
          ? color
          : ($theme.border ?? 'transparent')};
          border-bottom: 1px solid {hasActiveChild && collapsed
          ? color
          : ($theme.border ?? 'transparent')};
          border-left: none;
          border-radius: 0 6px 6px 0;
          cursor: {onBannerClick && !hasActiveChild ? 'pointer' : 'default'};
          transition: background 0.15s;
        "
        on:contextmenu={onBannerContextMenu}
        on:click={onBannerClick}
        on:mousedown={(e) => onGripMouseDown?.(e)}
        on:mouseenter={() => {
          bannerHovered = true;
          handleContainerEnter();
        }}
        on:mouseleave={() => {
          bannerHovered = false;
          handleContainerLeave();
        }}
      >
        <div
          data-container-banner-body
          style="padding-left: 8px; display: flex; flex-direction: column; gap: 2px; min-height: 32px; justify-content: center;"
        >
          <div
            style="display: flex; align-items: center; gap: 8px; min-width: 0;"
          >
            <slot name="icon" {bannerHovered} />
            <slot {bannerHovered} />
            <slot name="banner-end" {bannerHovered} {collapsed} />
          </div>
          <slot name="banner-subtitle" {bannerHovered} />
          {#if $$slots["btn-row"]}
            <div class="container-btn-row">
              <slot
                name="btn-row"
                {collapsed}
                toggle={() => (collapsed = !collapsed)}
              />
            </div>
          {/if}
        </div>
      </div>
      {#if !collapsed && filterIds.size > 0}
        <div
          data-container-nested={scopeId}
          data-nested-count={filterIds.size}
          style="display: flex; flex-direction: column;"
          transition:slide={{ duration: 200 }}
        >
          <svelte:component
            this={WorkspaceListViewResolved}
            {filterIds}
            accentColor={color}
            {scopeId}
            {containerBlockId}
            {containerLabel}
            {dashboardHintFor}
            {hideStatusBadges}
          />
        </div>
      {/if}
      <slot name="after-nested" />
    </div>
  </div>
{/if}

<style>
  .container-btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 4px 0 2px;
  }
</style>
