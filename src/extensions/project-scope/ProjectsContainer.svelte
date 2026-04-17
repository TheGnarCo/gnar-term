<script lang="ts">
  import { getContext, type Component } from "svelte";
  import { flip } from "svelte/animate";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import type { ProjectEntry } from "./index";
  import ProjectSectionContent from "./ProjectSectionContent.svelte";

  export let onCreateProject: () => void | Promise<void>;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const workspacesStore = api.workspaces;
  const { SplitButton, DragGrip } = api.getComponents();

  let stateVersion = 0;
  api.on("extension:project:state-changed", () => {
    stateVersion++;
  });

  let orderedProjects: ProjectEntry[] = [];

  $: {
    void $workspacesStore;
    void stateVersion;
    const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
    const order = api.state.get<string[]>("projectOrder") ?? [];
    const byId = new Map(projects.map((p) => [p.id, p]));
    const seen = new Set<string>();
    const next: ProjectEntry[] = [];
    for (const id of order) {
      const p = byId.get(id);
      if (p) {
        next.push(p);
        seen.add(id);
      }
    }
    for (const p of projects) {
      if (!seen.has(p.id)) next.push(p);
    }
    orderedProjects = next;
  }

  let projectHoverIdx: number | null = null;
  let sourceIdx: number | null = null;
  let indicator: { idx: number; edge: "before" | "after" } | null = null;
  let active = false;

  const reorder = api.createDragReorder({
    dataAttr: "project-drag-idx",
    containerSelector: ".projects-container",
    scope: "inner",
    ghostStyle: () => ({
      background: $theme.bgFloat ?? $theme.bgSurface ?? "#111",
      border: `1px solid ${$theme.accent}`,
    }),
    onDrop: (from, to) => {
      const next = [...orderedProjects];
      const [item] = next.splice(from, 1);
      if (!item) return;
      const insertAt = to > from ? to - 1 : to;
      next.splice(insertAt, 0, item);
      api.state.set(
        "projectOrder",
        next.map((p) => p.id),
      );
      api.emit("extension:project:state-changed", {});
    },
    onStateChange: () => sync(),
  });

  function sync() {
    const s = reorder.getState();
    sourceIdx = s.sourceIdx;
    indicator = s.indicator;
    active = s.active;
  }

  function startDrag(e: MouseEvent, idx: number) {
    reorder.start(e, idx);
  }
</script>

<div
  class="projects-container"
  style="padding: 2px 0; font-size: 12px; color: {$theme.fg};"
>
  <div style="padding: 4px 8px;">
    <svelte:component
      this={SplitButton as Component}
      label="New Project"
      onMainClick={() => {
        void onCreateProject();
      }}
      dropdownItems={[]}
      {theme}
      fullWidth={true}
    />
  </div>

  {#each orderedProjects as project, i (project.id)}
    <div animate:flip={{ duration: 200 }}>
      {#if indicator?.idx === i && indicator.edge === "before"}
        <div
          style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
        ></div>
      {/if}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        data-project-drag-idx={i}
        style="
          display: flex;
          opacity: {active && sourceIdx === i ? 0.4 : 1};
        "
      >
        <div
          on:mouseenter={() => (projectHoverIdx = i)}
          on:mouseleave={() => (projectHoverIdx = null)}
          style="flex-shrink: 0; align-self: stretch; display: flex;"
        >
          <svelte:component
            this={DragGrip as Component}
            theme={$theme}
            visible={projectHoverIdx === i || (active && sourceIdx === i)}
            onMouseDown={(e: MouseEvent) => startDrag(e, i)}
            ariaLabel="Drag project to reorder"
            railColor={project.color}
          />
        </div>
        <div style="flex: 1; min-width: 0;">
          <ProjectSectionContent projectId={project.id} />
        </div>
      </div>
      {#if indicator?.idx === i && indicator.edge === "after"}
        <div
          style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
        ></div>
      {/if}
    </div>
  {/each}
</div>
