<script lang="ts">
  import { getContext, onDestroy, type Component } from "svelte";
  import type ContainerRowType from "../../lib/components/ContainerRow.svelte";
  import type PathStatusLineType from "../../lib/components/PathStatusLine.svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    type WorkspaceActionContext,
    resolveProjectColor,
  } from "../api";
  import type { ProjectEntry } from "./index";
  import { openProjectDashboard, projectDashboardPath } from "./index";
  import { deleteProject, getProjects, updateProject } from "./project-service";
  import {
    getAllSurfaces,
    isPreviewSurface,
    type Workspace,
  } from "../../lib/types";

  export let projectId: string;
  /**
   * The namespaced sidebar-block id that hosts this project — passed
   * through from ProjectsContainer. Forwarded to the ContainerRow's
   * nested WorkspaceListView so workspace-drag ReorderContext publishes
   * the actual block id, not a hardcoded "projects" string.
   */
  export let containerBlockId: string = "";
  /**
   * Forwarded from ProjectRowBody — the drag grip is owned by
   * ContainerRow in root mode.
   */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /**
   * Project overlay directive, resolved by the parent from the current
   * reorder context. Covers the entire project block (header +
   * workspaces) as one zone.
   *   `strong` — greyish scrim with label centered; used for non-source
   *              projects during a project drag.
   *   `light`  — subtle dim, no label; used for non-parent projects
   *              during a nested workspace drag (the source project —
   *              the one the workspace belongs to — gets null and
   *              stays fully visible).
   */
  export let overlay:
    | { kind: "strong"; label: string }
    | { kind: "light" }
    | null = null;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const workspacesStore = api.workspaces;
  const contributors = api.childRowContributors;
  const { WorkspaceListView, SplitButton, ContainerRow, PathStatusLine } =
    api.getComponents();
  // Type-only import binds slot defs so <svelte:component> can type-check
  // the slot contents this file provides.
  const ContainerRowTyped = ContainerRow as typeof ContainerRowType;
  const PathStatusLineTyped = PathStatusLine as typeof PathStatusLineType;

  let project: ProjectEntry | undefined;
  let stateVersion = 0;

  // Re-read when project state changes (not reactive — force via event).
  // Handler captured as a named ref so onDestroy can api.off() the same
  // function. Without this, every mount (one per project) leaves a
  // permanent listener behind — they accumulate across project
  // add/remove cycles and tick stateVersion in dead components.
  const onProjectStateChanged = () => {
    stateVersion++;
  };
  api.on("extension:project:state-changed", onProjectStateChanged);
  onDestroy(() => {
    api.off("extension:project:state-changed", onProjectStateChanged);
  });

  // Re-read project data whenever workspaces change or project state is updated
  $: {
    void $workspacesStore;
    void stateVersion;
    project = getProjects(api).find((p) => p.id === projectId);
  }

  $: filterIds = project ? new Set(project.workspaceIds) : new Set<string>();

  // Re-evaluate contributed children when contributors register/unregister.
  $: void $contributors;
  $: childRows = project ? api.getChildRowsFor("project", project.id) : [];

  $: projectContext = project
    ? ({
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name,
        isGit: project.isGit,
        // Forwarded so workspace actions spawned from a project (e.g.
        // "New Agent Dashboard") can inherit the project's palette
        // choice without a second lookup through getProjects.
        projectColor: project.color,
      } satisfies WorkspaceActionContext)
    : undefined;

  $: actions = projectContext
    ? api
        .getWorkspaceActions()
        .filter((a) => !a.when || a.when(projectContext!))
    : [];

  $: coreAction = actions.find((a) => a.id === "core:new-workspace");
  $: otherActions = actions.filter((a) => a.id !== "core:new-workspace");

  async function handleRenameProject() {
    if (!project) return;
    const next = await api.showInputPrompt("Rename project", project.name);
    const trimmed = next?.trim();
    if (!trimmed || trimmed === project.name) return;
    updateProject(api, project.id, { name: trimmed });
  }

  function handleDeleteProject() {
    if (!project) return;
    deleteProject(api, project.id);
  }

  function handleBannerContextMenu(e: MouseEvent) {
    if (!project) return;
    e.preventDefault();
    e.stopPropagation();
    const items: Array<{
      label: string;
      action: () => void;
      shortcut?: string;
      separator?: boolean;
      danger?: boolean;
    }> = [
      {
        label: "Rename Project",
        action: () => {
          void handleRenameProject();
        },
      },
      {
        label: "Open Project Dashboard",
        action: () => {
          if (project) void openProjectDashboard(project);
        },
      },
    ];
    // Append "New <action>" items contributed for this project (New
    // Workspace from core, New Agent Dashboard, etc.) so the banner
    // menu mirrors the same surface the split-button dropdown offers.
    if (coreAction && projectContext) {
      items.push({
        label: "New Workspace",
        action: () => coreAction!.handler(projectContext!),
      });
    }
    for (const a of otherActions) {
      items.push({
        label: a.label,
        action: () => void a.handler(projectContext!),
      });
    }
    items.push({ label: "", action: () => {}, separator: true });
    items.push({
      label: "Delete Project",
      danger: true,
      action: handleDeleteProject,
    });
    api.showContextMenu(e.clientX, e.clientY, items);
  }

  // Pick a foreground that remains legible on an arbitrary project color.
  // Mirrors src/lib/utils/contrast.ts — duplicated here because the
  // extension-barrier test forbids extensions from importing core lib
  // utilities.
  function contrastColor(hex: string): string {
    const clean = hex.replace(/^#/, "");
    if (clean.length !== 6) return "#fff";
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? "#000" : "#fff";
  }

  // Resolve slot or hex to a concrete color for this theme. Downstream
  // inline styles paint projectHex (not project.color) so slot-based
  // selections follow the active theme.
  $: projectHex = project ? resolveProjectColor(project.color, $theme) : "";
  $: headerFg = project ? contrastColor(projectHex) : $theme.fg;
  // Muted contrast foreground for the subtitle row inside the banner.
  // Derived from headerFg so it stays readable on any project color —
  // white@0.8 on dark banners, black@0.7 on light banners.
  $: subtitleFg =
    headerFg === "#000" ? "rgba(0, 0, 0, 0.7)" : "rgba(255, 255, 255, 0.8)";

  $: splitDropdownItems = [
    {
      id: "new-workspace",
      label: "New Workspace",
      icon: "plus",
      handler: () => {
        if (coreAction && projectContext)
          void coreAction.handler(projectContext);
      },
    },
    ...otherActions.map((a) => ({
      id: a.id,
      label: a.label,
      icon: a.icon,
      handler: () => {
        void a.handler(projectContext!);
      },
    })),
  ];

  function handleBannerClick() {
    if (project) void openProjectDashboard(project);
  }

  // Close X on the project container row — destructive; deletes the
  // project entity. Confirms first. Nested workspaces are unclaimed and
  // return to the root-level list; they are not closed. Per user
  // direction: "Projects delete project; Agent-dashboards delete
  // dashboard."
  async function handleClose() {
    if (!project) return;
    const confirmed = await api.showConfirm(
      `Delete project "${project.name}"? Workspaces belonging to this project return to the root list; they are not closed.`,
      {
        title: "Delete Project",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
    if (!confirmed) return;
    handleDeleteProject();
  }

  // Dashboard-hint for nested workspaces: surface-based. Any workspace
  // whose panes currently contain a preview surface at the project's
  // dashboard path gets a dashboard icon — clicking it opens that
  // dashboard (via openProjectDashboard, which focuses the existing
  // preview if present). Unlike agent-dashboards (tagged by metadata),
  // project-dashboard hosts are identified dynamically by surface
  // presence so any project workspace that happens to host the preview
  // gets the indicator.
  function hintForProjectDashboardHost(ws: Workspace) {
    if (!project) return undefined;
    const path = projectDashboardPath(project.path);
    const hosts = getAllSurfaces(ws).some(
      (s) => isPreviewSurface(s) && s.path === path,
    );
    if (!hosts) return undefined;
    return {
      id: project.id,
      color: projectHex,
      onClick: () => {
        if (project) void openProjectDashboard(project);
      },
    };
  }
</script>

{#if project}
  <div
    data-project-section
    data-project-id={project.id}
    style="
      font-size: 12px; color: {$theme.fg};
      position: relative;
    "
  >
    <svelte:component
      this={ContainerRowTyped}
      color={projectHex}
      foreground={headerFg}
      {onGripMouseDown}
      gripAriaLabel="Drag project to reorder"
      onBannerClick={handleBannerClick}
      onBannerContextMenu={handleBannerContextMenu}
      onClose={handleClose}
      closeTitle="Delete project"
      {filterIds}
      dashboardHintFor={hintForProjectDashboardHost}
      scopeId={project.id}
      {containerBlockId}
      containerLabel={project.name}
      testId={project.id}
      workspaceListViewComponent={WorkspaceListView ?? undefined}
    >
      <!-- Title fills the main banner slot; flex:1 pushes banner-end to
           the right. Clicking the title is redundant with the
           banner-wide onBannerClick, but kept here as an accessibility
           hit target with its own cursor styling. -->
      <span
        style="
          flex: 1; min-width: 0;
          font-size: 13px; font-weight: 600; color: {headerFg};
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        ">{project.name}</span
      >

      <svelte:fragment slot="banner-end">
        {#if coreAction}
          <!-- Button chip: borderless wash of the banner's contrast color
               so the button reads as a tonal shift of the project color
               on any hue. stopPropagation keeps clicks on the chip from
               bubbling up to ContainerRow's banner-wide click handler. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="project-new-chip"
            on:click|stopPropagation
            style="
              flex-shrink: 0; border-radius: 6px; overflow: visible;
              background: {headerFg === '#000'
              ? 'rgba(0, 0, 0, 0.12)'
              : 'rgba(0, 0, 0, 0.22)'};
              --project-btn-fg: {headerFg};
              --project-btn-hover-bg: {headerFg === '#000'
              ? 'rgba(0, 0, 0, 0.22)'
              : 'rgba(0, 0, 0, 0.36)'};
            "
          >
            <svelte:component
              this={SplitButton as Component}
              label="+ New"
              onMainClick={() => coreAction?.handler(projectContext ?? {})}
              dropdownItems={splitDropdownItems}
              {theme}
            />
          </span>
        {/if}
      </svelte:fragment>

      <svelte:fragment slot="banner-subtitle">
        <!-- Status line: project path/branch on row 1, open PRs + dirty
             count on row 2. Lives inside the banner so the project row
             encapsulates both the title and its subtitle metadata under
             a single colored background. -->
        <div style="pointer-events: auto;">
          <svelte:component
            this={PathStatusLineTyped}
            target={{
              id: project.id,
              path: project.path,
              isGit: project.isGit,
            }}
            fgColor={subtitleFg}
          />
        </div>
      </svelte:fragment>

      <svelte:fragment slot="after-nested">
        <!-- Contributed child rows (e.g. agentic-orchestrator dashboards
             tagged with parentProjectId === project.id). Each row
             dispatches to whichever extension registered a renderer for
             its kind via registerRootRowRenderer. -->
        {#if childRows.length > 0}
          <div
            data-project-children={project.id}
            style="display: flex; flex-direction: column;"
          >
            {#each childRows as row (row.kind + ":" + row.id)}
              {@const renderer = api.getRootRowRenderer(row.kind)}
              {#if renderer}
                <svelte:component
                  this={renderer.component as Component}
                  id={row.id}
                  parentColor={projectHex}
                />
              {/if}
            {/each}
          </div>
        {/if}
      </svelte:fragment>
    </svelte:component>

    <!-- Unified project overlay: one scrim covering header + workspaces.
         Strong variant (project drag, non-source project) paints the
         full block with THIS project's color — solid and opaque — so
         during a drag each non-source project reads as its own colored
         tile with its name centered. Light variant (nested workspace
         drag on a non-parent project) still renders a subtle dim.
         Left: -10px extends over the grip column so the drag overlay
         covers the full row without a visible gap at the rail edge. -->
    {#if overlay}
      <div
        style="
          position: absolute; top: 0; right: 0; bottom: 0; left: -10px;
          background: {overlay.kind === 'strong'
          ? projectHex
          : 'rgba(0, 0, 0, 0.4)'};
          pointer-events: none;
          display: flex; align-items: center; justify-content: center;
          z-index: 2;
        "
      >
        {#if overlay.kind === "strong"}
          <span style="color: {headerFg}; font-size: 13px; font-weight: 600;"
            >{overlay.label}</span
          >
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* SplitButton inside the banner-embedded "+ New" chip:
     1. suppress theme.border — pale default read as a stray outline on
        a saturated banner
     2. force button label + caret to the banner's contrast color
        (--project-btn-fg) so text reads as strongly as the title, not
        the weak theme.fgDim. currentColor on the caret SVG inherits.
     3. override the hover-bg SplitButton sets via JS inline style
        (element.style.background = theme.bgHighlight). Stylesheet
        !important beats inline non-important, so the chip-appropriate
        hover tint wins and we don't see a grey theme highlight over
        a saturated banner. */
  :global(.project-new-chip button) {
    border-color: transparent !important;
    color: var(--project-btn-fg) !important;
  }
  :global(.project-new-chip button:hover) {
    background: var(--project-btn-hover-bg) !important;
  }
</style>
