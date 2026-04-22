<script lang="ts">
  import { getContext, onDestroy, type Component } from "svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    type WorkspaceActionContext,
    resolveProjectColor,
  } from "../api";
  import type { ProjectEntry } from "./index";
  import { dashboardProjectId$ } from "./index";
  import { getProjects } from "./project-service";
  import ProjectStatusLine from "./ProjectStatusLine.svelte";

  export let projectId: string;
  /**
   * The namespaced sidebar-block id that hosts this project — passed
   * through from ProjectsContainer. Forwarded to WorkspaceListView as
   * `containerBlockId` so workspace-drag ReorderContext publishes the
   * actual block id, not a hardcoded "projects" string.
   */
  export let containerBlockId: string = "";
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
  /**
   * When true, render a dark-dot overlay on the banner's first 10px so
   * the portion of the project rail that overlaps the project row
   * reads dark against the bright project color. Driven by the
   * parent's expanded/hover state — matches when the DragGrip is
   * rendering its own colored dots on the rail proper so the two
   * zones read as one continuous frit with a dark band in the banner.
   */
  export let showBannerFrit: boolean = false;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const workspacesStore = api.workspaces;
  const { WorkspaceListView, SplitButton } = api.getComponents();

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

  $: projectContext = project
    ? ({
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name,
        isGit: project.isGit,
      } satisfies WorkspaceActionContext)
    : undefined;

  $: actions = projectContext
    ? api
        .getWorkspaceActions()
        .filter((a) => !a.when || a.when(projectContext!))
    : [];

  $: coreAction = actions.find((a) => a.id === "core:new-workspace");
  $: otherActions = actions.filter((a) => a.id !== "core:new-workspace");

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
</script>

{#if project}
  <div
    style="
      font-size: 12px; color: {$theme.fg};
      position: relative;
    "
  >
    <!-- Project header: painted with the project's color so it reads as a
         banner for this project. Title color is derived for contrast
         (white on dark, black on light). Banner overlaps the rail by
         its current width (10px rest, 20px expanded) so the dark frit
         zone paints dark dots over the rail's colored dots in the
         header row. On hover, the banner bumps to z:2 above the rail
         wrapper (z:1 in ProjectsContainer while expanded) so the
         banner's frit paints above the rail's colored frit. -->
    <div
      style="
        position: relative;
        padding: 4px 6px;
        background: {projectHex}; color: {headerFg};
        border-radius: 0 6px 6px 0;
      "
    >
      <!-- Left-edge frit continuation: the rail's diamond pattern
           extends onto the banner's left edge with an aggressive
           fade-out to the right. Rail and banner share projectHex
           bg so there's no color seam; this pass concentrates the
           dots near the rail and drops off fast — fully clear by
           the time the banner's content area starts. Rendered in
           both rest and expanded states. -->
      <div
        aria-hidden="true"
        style="
          position: absolute;
          top: 0; bottom: 0;
          left: 0; width: 14px;
          pointer-events: none;
          background-image:
            radial-gradient(circle, #000 1.1px, transparent 1.6px),
            radial-gradient(circle, #000 1.1px, transparent 1.6px);
          background-size: 5px 5px;
          background-position: 0 0, 2.5px 2.5px;
          background-repeat: repeat;
          -webkit-mask-image: linear-gradient(
            to right,
            rgba(0, 0, 0, 1) 0%,
            rgba(0, 0, 0, 0.5) 25%,
            rgba(0, 0, 0, 0.15) 60%,
            rgba(0, 0, 0, 0) 100%
          );
          mask-image: linear-gradient(
            to right,
            rgba(0, 0, 0, 1) 0%,
            rgba(0, 0, 0, 0.5) 25%,
            rgba(0, 0, 0, 0.15) 60%,
            rgba(0, 0, 0, 0) 100%
          );
        "
      ></div>
      <!-- Title row: 8px left padding creates the same gap other rows
           use between the rail's right edge and their leading content. -->
      <div
        style="
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px;
          padding-left: 8px;
          pointer-events: auto;
        "
      >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          style="
            display: flex; align-items: center;
            min-width: 0; flex: 1; cursor: pointer;
          "
          on:click={() => {
            if (project) dashboardProjectId$.set(project.id);
          }}
        >
          <span
            style="
              font-size: 13px; font-weight: 600; color: {headerFg};
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            ">{project.name}</span
          >
        </div>
        {#if coreAction}
          <!-- Button chip: borderless wash of the banner's contrast color, so
               the button reads as a tonal shift of the project color on any
               hue. SplitButton's internal theme.border is suppressed inside
               this chip via the scoped :global rule below — on a saturated
               banner that pale grey line looked like an outline around the
               button rather than part of the design. -->
          <span
            class="project-new-chip"
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
      </div>

      <!-- Status line: project path/branch on row 1, open PRs + dirty
           count on row 2. Lives inside the banner so the project row
           encapsulates both the title and its subtitle metadata under a
           single colored background. pointer-events:auto keeps PR
           links clickable (outer banner is pointer-events:none so the
           rail-overlap zone falls through to the grip). -->
      <div style="pointer-events: auto;">
        <ProjectStatusLine {project} fgColor={subtitleFg} />
      </div>
    </div>

    <!-- Workspace list — left edge flush with the content column (same
         as ProjectStatusLine's box), so workspaces sit directly under
         the project's subtext row with no extra inset. Each workspace's
         own rail starts at content-col-x=0 (right after the project
         rail's right edge) — adjacent but not overlapping, so the
         hierarchy reads without wasted air. -->
    <div style="margin-left: 0;">
      <svelte:component
        this={WorkspaceListView as Component}
        {filterIds}
        accentColor={projectHex}
        scopeId={project.id}
        {containerBlockId}
      />
    </div>

    <!-- Unified project overlay: one scrim covering header + workspaces.
         Strong variant (project drag, non-source project) paints the full
         block with THIS project's color — solid and opaque — so during a
         drag each non-source project reads as its own colored tile with
         its name centered. Light variant (nested workspace drag on a
         non-parent project) still renders a subtle dim. -->
    {#if overlay}
      <!-- left: -10px extends the overlay across the drag-grip rail column
           (10px wide, sibling of this content div in ProjectsContainer).
           Without this, the strong-variant overlay leaves a visible gap
           between the rail and the project body during a project drag. -->
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
