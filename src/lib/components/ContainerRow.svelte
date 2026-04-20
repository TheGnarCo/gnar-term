<script lang="ts">
  /**
   * ContainerRow — shared root-row chrome for "container workspaces" in
   * the Workspaces sidebar section. Encodes the three shapes the sidebar
   * supports:
   *
   *   - **Container Workspaces** (projects, agent dashboards) render a
   *     colored banner + a nested list of workspaces. This component is
   *     that shell: grip on the left, colored banner body on the right,
   *     nested WorkspaceListView below.
   *   - **Nested Workspaces** are rendered by the nested WorkspaceListView
   *     slot (via `filterIds`).
   *   - **Root Workspaces** render directly via WorkspaceItem — NOT this
   *     component.
   *
   * Two usage modes driven by callers:
   *
   *   1. *Pure-chrome* — the banner is a visual header only (e.g. project
   *      rows). Caller provides `onBannerClick`, `onBannerContextMenu`,
   *      and fills the `icon` / `banner-end` / `banner-subtitle` slots.
   *
   *   2. *Workspace-backed* — the banner represents a first-class
   *      workspace (e.g. the hosting workspace of an agent dashboard).
   *      Caller provides `onClose` for the close affordance (usually
   *      wrapping `closeWorkspace(idx)`) and `onBannerClick` wired to
   *      `switchWorkspace(idx)`. The slots fill in dashboard-specific
   *      chrome (icon, status badges, latest event).
   *
   * Visual variants:
   *   - `parentColor` unset → root mode: grip + banner + nested list
   *     stretch together with the shared rail color.
   *   - `parentColor` set → nested-inside-another-container mode: banner
   *     only, no outer grip, with the dashboard/project color painting
   *     the banner background and a small accent strip on the right.
   */
  import { type Component } from "svelte";
  import { theme } from "../stores/theme";
  import { reorderContext } from "../stores/ui";
  import DragGrip from "./DragGrip.svelte";
  import DefaultWorkspaceListView from "./WorkspaceListView.svelte";
  import type { Workspace } from "../types";

  /** Banner + rail color. Required. */
  export let color: string;
  /** Contrast foreground — caller resolves via its own contrastColor(). */
  export let foreground: string = "#fff";
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
  export let gripAriaLabel: string = "Drag to reorder";

  /** Banner body click — ignored if undefined. */
  export let onBannerClick: (() => void) | undefined = undefined;
  /** Banner body right-click — ignored if undefined. */
  export let onBannerContextMenu: ((e: MouseEvent) => void) | undefined =
    undefined;
  /**
   * When provided, render a close affordance ("X") on the banner's right
   * edge. Click fires `onClose`. In workspace-backed mode, callers wire
   * this to `closeWorkspace(idx)` — the ContainerRow stays agnostic
   * about what "close" means.
   */
  export let onClose: (() => void) | undefined = undefined;
  export let closeTitle: string = "Close";

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

  let gripHovered = false;
  let bannerHovered = false;

  $: bannerClickable = !!onBannerClick;
  $: WorkspaceListViewResolved = (workspaceListViewComponent ??
    DefaultWorkspaceListView) as Component;
</script>

{#if parentColor}
  <!-- Nested-inside-parent variant — banner only, right-edge accent. -->
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
        cursor: {bannerClickable ? 'pointer' : 'default'};
        background: {color}; color: {foreground};
      "
      on:click={onBannerClick}
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
      </div>
      {#if onClose}
        <!-- Close X — absolute-positioned so it never pushes banner
             content around. Matches WorkspaceItem's close affordance:
             centered vertically against the full banner height,
             opacity 0 at rest, fading in on banner hover. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <span
          data-container-banner-close
          title={closeTitle}
          role="button"
          tabindex="0"
          on:click|stopPropagation={onClose}
          style="
            position: absolute;
            top: 50%; right: 6px;
            transform: translateY(-50%);
            color: {foreground};
            font-size: 14px;
            cursor: pointer;
            opacity: {bannerHovered ? '1' : '0'};
            transition: opacity 0.15s;
            padding: 0 2px;
            z-index: 1;
          ">×</span
        >
      {/if}
    </div>
    {#if filterIds.size > 0}
      <div
        data-container-nested={scopeId}
        data-nested-count={filterIds.size}
        style="display: flex; flex-direction: column;"
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
  <!-- Root variant — grip on the left shares color with banner. -->
  <div
    data-container-row={testId ?? ""}
    data-container-mode="root"
    style="display: flex; position: relative;"
  >
    {#if onGripMouseDown}
      <div
        on:mouseenter={() => (gripHovered = true)}
        on:mouseleave={() => (gripHovered = false)}
        style="
          flex-shrink: 0; align-self: stretch; display: flex;
          background: {color};
        "
        role="presentation"
      >
        <DragGrip
          theme={$theme}
          visible={gripHovered && $reorderContext === null}
          onMouseDown={onGripMouseDown}
          ariaLabel={gripAriaLabel}
          railColor={color}
          dotColor="#000"
          railOpacity={1}
          alwaysShowDots={true}
        />
      </div>
    {/if}
    <div style="flex: 1; min-width: 0; margin-right: 8px;">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        data-container-banner
        style="
          position: relative;
          padding: 4px 6px;
          min-height: 40px;
          background: {color}; color: {foreground};
          border-radius: 0 6px 6px 0;
          cursor: {bannerClickable ? 'pointer' : 'default'};
        "
        on:click={onBannerClick}
        on:contextmenu={onBannerContextMenu}
        on:mouseenter={() => (bannerHovered = true)}
        on:mouseleave={() => (bannerHovered = false)}
      >
        <div
          data-container-banner-body
          style="padding-left: 8px; display: flex; flex-direction: column; gap: 2px; min-height: 32px; justify-content: center;"
        >
          <div
            style="display: flex; align-items: center; gap: 8px; min-width: 0;"
          >
            <slot name="icon" />
            <slot />
            <slot name="banner-end" />
          </div>
          <slot name="banner-subtitle" />
        </div>
        {#if onClose}
          <!-- Close X — absolute-positioned so it never pushes banner
               content around. Matches WorkspaceItem's close affordance:
               centered vertically against the full banner height,
               opacity 0 at rest, fading in on banner hover. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <span
            data-container-banner-close
            title={closeTitle}
            role="button"
            tabindex="0"
            on:click|stopPropagation={onClose}
            style="
              position: absolute;
              top: 50%; right: 6px;
              transform: translateY(-50%);
              color: {foreground};
              font-size: 14px;
              cursor: pointer;
              opacity: {bannerHovered ? '1' : '0'};
              transition: opacity 0.15s;
              padding: 0 2px;
              z-index: 1;
            ">×</span
          >
        {/if}
      </div>
      {#if filterIds.size > 0}
        <div
          data-container-nested={scopeId}
          data-nested-count={filterIds.size}
          style="display: flex; flex-direction: column;"
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
