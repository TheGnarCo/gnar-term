<script lang="ts">
  /**
   * ProjectRowBody — the root-row renderer for project blocks inside
   * the Workspaces section. Renders its OWN DragGrip (left) + a
   * rounded-right content column containing the project banner +
   * subtitle + nested workspace list. Core (WorkspaceListBlock) owns
   * the drag pipeline — the grip here just forwards mousedown to
   * the onGripMouseDown prop.
   *
   * Registered via `api.registerRootRowRenderer("project", ...)`.
   * The registry invokes the component with `{ id, onGripMouseDown }`.
   */
  import { getContext, type Component } from "svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    resolveProjectColor,
  } from "../api";
  import { getProjects } from "./project-service";
  import ProjectSectionContent from "./ProjectSectionContent.svelte";

  export let id: string;
  /** Forwarded to core's createDragReorder for this root row. */
  export let onGripMouseDown: (e: MouseEvent) => void = () => {};

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const reorderCtx = api.reorderContext;
  const { DragGrip } = api.getComponents();

  $: project = getProjects(api).find((p) => p.id === id);
  $: projectHex = project ? resolveProjectColor(project.color, $theme) : "";

  // Local grip-hover state drives the rail width.
  let gripHovered = false;
</script>

{#if project}
  <div style="display: flex; position: relative;">
    <!-- Grip wrapper shares the project color so the rail and
         banner are one continuous color field — no seam where the
         two meet. Dots painted on top in dark so they read against
         the project color; the banner's continuation frit uses the
         same dark ink and simply fades out into the banner area. -->
    <div
      on:mouseenter={() => (gripHovered = true)}
      on:mouseleave={() => (gripHovered = false)}
      style="
        flex-shrink: 0; align-self: stretch; display: flex;
        background: {projectHex};
      "
      role="presentation"
    >
      <svelte:component
        this={DragGrip as Component}
        theme={$theme}
        visible={gripHovered && $reorderCtx === null}
        onMouseDown={onGripMouseDown}
        ariaLabel="Drag project to reorder"
        railColor={projectHex}
        dotColor="#000"
        railOpacity={1}
        alwaysShowDots={true}
      />
    </div>
    <!-- Content column — transparent wrapper. Only the banner inside
         carries the project color + rounded corners; nested
         workspaces below sit on the default sidebar bg with their
         own shapes. 8px trailing right margin matches workspace
         rows. -->
    <div
      style="
        flex: 1; min-width: 0;
        margin-right: 8px;
      "
    >
      <ProjectSectionContent
        projectId={id}
        containerBlockId="__workspaces__"
        overlay={null}
      />
    </div>
  </div>
{/if}
