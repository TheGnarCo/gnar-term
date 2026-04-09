<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import {
    sidebarVisible,
    contextMenu,
    openWorkspace,
    currentView,
    currentProjectId,
    goHome,
    goToProject,
  } from "../stores/ui";
  import {
    workspaces,
    activeWorkspaceIdx,
    projectWorkspaceMap,
    floatingWorkspaces,
    reorderProjectWorkspaces,
    reorderFloating,
  } from "../stores/workspace";
  import { activeProjects, reorderProjects } from "../stores/project";
  import {
    getAggregatedHarnessStatus,
    type Workspace,
    type AgentStatus,
    type AggregatedHarnessStatus,
  } from "../types";
  import { fetchChanges } from "../right-sidebar-data";
  import type { FileStatus } from "../git";
  import type { MenuItem } from "../context-menu-types";
  import { agentStatusColor } from "../agent-utils";
  import { startSidebarResize } from "../sidebar-resize";

  export let onSwitchWorkspace: (idx: number) => void;
  export let onCloseWorkspace: (idx: number) => void;
  export let onRenameWorkspace: (idx: number, name: string) => void;
  export let onNewWorkspace: (projectId: string) => void;
  export let onNewFloatingWorkspace: () => void;
  export let onAddProject: () => void;

  let hoveredWsIdx: number | null = null;
  let sidebarWidth = 220;
  let dragging = false;

  function startResize(e: MouseEvent) {
    dragging = true;
    startSidebarResize(
      e,
      "left",
      sidebarWidth,
      160,
      0.45,
      (w) => (sidebarWidth = w),
      () => (dragging = false),
    );
  }
  let hoveredSection: string | null = null;
  let hoveredProject: string | null = null;

  // --- Git status cache for managed workspace cards ---
  let gitStatusCache = new Map<
    string,
    { added: number; modified: number; deleted: number }
  >();
  let gitStatusPending = new Set<string>();

  function fetchGitStatus(wsId: string, worktreePath: string) {
    if (gitStatusPending.has(wsId)) return;
    gitStatusPending.add(wsId);
    fetchChanges(worktreePath).then((files) => {
      let added = 0,
        modified = 0,
        deleted = 0;
      for (const f of files) {
        const s = f.workStatus !== " " ? f.workStatus : f.indexStatus;
        if (s === "?" || s === "A") added++;
        else if (s === "D") deleted++;
        else modified++;
      }
      gitStatusCache.set(wsId, { added, modified, deleted });
      gitStatusCache = gitStatusCache; // trigger reactivity
      gitStatusPending.delete(wsId);
    });
  }

  function harnessTooltip(agg: AggregatedHarnessStatus): string {
    const parts: string[] = [];
    if (agg.running > 0) parts.push(`${agg.running} running`);
    if (agg.waiting > 0) parts.push(`${agg.waiting} waiting`);
    if (agg.idle > 0) parts.push(`${agg.idle} idle`);
    if (agg.error > 0) parts.push(`${agg.error} error`);
    const exited = agg.total - agg.running - agg.waiting - agg.idle - agg.error;
    if (exited > 0) parts.push(`${exited} exited`);
    return `Agents (${agg.total}): ${parts.join(", ")}`;
  }

  // --- Animated status indicator ---
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let spinnerFrame = 0;
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;

  function ensureSpinner(hasRunning: boolean) {
    if (hasRunning && !spinnerInterval) {
      spinnerInterval = setInterval(() => {
        spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      }, 200);
    } else if (!hasRunning && spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
  }

  onDestroy(() => {
    if (spinnerInterval) clearInterval(spinnerInterval);
  });

  function statusIndicator(status: AgentStatus): string {
    switch (status) {
      case "running":
        return SPINNER_FRAMES[spinnerFrame];
      case "waiting":
        return "◆";
      case "idle":
        return "●";
      case "error":
        return "✕";
      case "exited":
        return "○";
    }
  }

  function statusColor(status: AgentStatus): string {
    return agentStatusColor(status, $theme);
  }

  // Refresh git stats when workspaces change
  $: {
    for (const [, entries] of $projectWorkspaceMap) {
      for (const { ws } of entries) {
        if (
          ws.record?.type === "managed" &&
          ws.record.worktreePath &&
          !gitStatusCache.has(ws.id)
        ) {
          fetchGitStatus(ws.id, ws.record.worktreePath);
        }
      }
    }
  }

  function handleWorkspaceClick(idx: number) {
    onSwitchWorkspace(idx);
    openWorkspace();
  }

  // --- Drag & drop reordering (pure mouse events — HTML5 DnD broken in Tauri WKWebView) ---

  type DragSource =
    | { kind: "ws"; scope: string; localIdx: number }
    | { kind: "proj"; idx: number };
  let dragSource: DragSource | null = null;
  let insertIndicator: {
    scope: string;
    localIdx: number;
    edge: "before" | "after";
  } | null = null;
  let dragActive = false;
  let ghostEl: HTMLElement | null = null;

  function startDrag(e: MouseEvent, source: DragSource) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const originEl = (e.target as HTMLElement).closest(
      "[data-drag-scope]",
    ) as HTMLElement | null;

    function onMove(ev: MouseEvent) {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 5) {
        ev.preventDefault();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUpCancel);
        dragSource = source;
        dragActive = true;
        document.body.style.cursor = "grabbing";
        if (originEl) {
          ghostEl = originEl.cloneNode(true) as HTMLElement;
          Object.assign(ghostEl.style, {
            position: "fixed",
            zIndex: "99999",
            pointerEvents: "none",
            width: originEl.offsetWidth + "px",
            opacity: "0.8",
            background: $theme.bgFloat,
            border: `1px solid ${$theme.accent}`,
            borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            left: ev.clientX + 8 + "px",
            top: ev.clientY - 12 + "px",
          });
          document.body.appendChild(ghostEl);
        }
        window.addEventListener("mousemove", onDragMove);
        window.addEventListener("mouseup", onDragEnd);
      }
    }

    function onUpCancel() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUpCancel);
    }

    e.preventDefault();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUpCancel);
  }

  function onDragMove(e: MouseEvent) {
    if (!dragSource) return;
    if (ghostEl) {
      ghostEl.style.left = e.clientX + 8 + "px";
      ghostEl.style.top = e.clientY - 12 + "px";
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) {
      insertIndicator = null;
      return;
    }
    const item = (el as HTMLElement).closest(
      "[data-drag-scope]",
    ) as HTMLElement | null;
    // If cursor is in a gap (margin/padding) but still in sidebar, keep the last indicator
    if (!item) {
      const inSidebar = (el as HTMLElement).closest("#sidebar");
      if (inSidebar) return; // keep current insertIndicator
      insertIndicator = null;
      return;
    }

    const scope = item.dataset.dragScope!;
    const localIdx = parseInt(item.dataset.dragIdx!, 10);

    if (
      dragSource.kind === "ws" &&
      (scope === "__projects__" || dragSource.scope !== scope)
    ) {
      insertIndicator = null;
      return;
    }
    if (dragSource.kind === "proj") {
      // Resolve which project block the cursor is in
      let projIdx: number;
      if (scope === "__projects__") {
        projIdx = localIdx;
      } else {
        projIdx = $activeProjects.findIndex((p) => p.id === scope);
        if (projIdx < 0) {
          insertIndicator = null;
          return;
        }
      }
      // Use the full project block (header + workspaces) for edge calculation
      const block = document.querySelector(
        `[data-project-block="${projIdx}"]`,
      ) as HTMLElement | null;
      if (!block) {
        insertIndicator = null;
        return;
      }
      const rect = block.getBoundingClientRect();
      const edge: "before" | "after" =
        e.clientY - rect.top < rect.height / 2 ? "before" : "after";
      insertIndicator = { scope: "__projects__", localIdx: projIdx, edge };
      return;
    }

    const rect = item.getBoundingClientRect();
    const edge: "before" | "after" =
      e.clientY - rect.top < rect.height / 2 ? "before" : "after";
    insertIndicator = { scope, localIdx, edge };
  }

  function onDragEnd() {
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }

    if (dragSource && insertIndicator) {
      if (
        dragSource.kind === "ws" &&
        dragSource.scope === insertIndicator.scope
      ) {
        const from = dragSource.localIdx;
        let to = insertIndicator.localIdx;
        if (insertIndicator.edge === "after") to += 1;
        if (from < to) to -= 1;
        if (from !== to) {
          const scope = insertIndicator.scope;
          if (scope === "floating") reorderFloating(from, to);
          else reorderProjectWorkspaces(scope, from, to);
        }
      } else if (
        dragSource.kind === "proj" &&
        insertIndicator.scope === "__projects__"
      ) {
        const from = dragSource.idx;
        let to = insertIndicator.localIdx;
        if (insertIndicator.edge === "after") to += 1;
        if (from < to) to -= 1;
        if (from !== to) reorderProjects(from, to);
      }
    }

    dragSource = null;
    insertIndicator = null;
    dragActive = false;
    document.body.style.cursor = "";
  }

  function showWorkspaceContextMenu(
    x: number,
    y: number,
    idx: number,
    projectId: string,
  ) {
    const ws = $workspaces[idx];
    if (!ws) return;

    const isWorktree = ws.record?.type === "managed";
    const projectWsList = $projectWorkspaceMap.get(projectId) || [];

    const items: MenuItem[] = [];

    // Rename only for terminal workspaces (not managed — those are named after the branch)
    if (!isWorktree) {
      items.push({
        label: "Rename",
        shortcut: "\u21e7\u2318R",
        action: () => onRenameWorkspace(idx, ws.name),
      });
    }

    items.push(
      { label: "", action: () => {}, separator: true },
      {
        label: "Close Other Workspaces",
        disabled: projectWsList.length <= 1,
        action: () => {
          for (let i = $workspaces.length - 1; i >= 0; i--) {
            if (i !== idx && $workspaces[i]?.record?.projectId === projectId) {
              onCloseWorkspace(i);
            }
          }
        },
      },
      {
        label: "Close Workspace",
        shortcut: "\u21e7\u2318W",
        danger: true,
        action: () => onCloseWorkspace(idx),
      },
    );
    contextMenu.set({ x, y, items });
  }

  /** No-op kept for API compatibility (collapsible state removed) */
  export function expandProject(_projectId: string) {}

  // Expose startRename for keyboard shortcut compatibility
  export function startRename(idx: number) {
    const ws = $workspaces[idx];
    if (ws) {
      onRenameWorkspace(idx, ws.name);
    }
  }

  function relativeAge(ts: number | undefined): string {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return `${months}mo`;
  }
</script>

{#if $sidebarVisible}
  <!-- Full sidebar -->
  <div
    id="sidebar"
    style="
      width: {sidebarWidth}px; min-width: 160px;
      background: {$theme.sidebarBg}; border-right: 1px solid {$theme.bg};
      display: flex; flex-direction: row; overflow: hidden;
      font-size: 13px; user-select: {dragging || dragActive ? 'none' : 'auto'};
      position: relative;
    "
  >
    <div
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"
    >
      <!-- Scrollable content area -->
      <div style="flex: 1; overflow-y: auto; padding: 4px 0;">
        <!-- Dashboard link -->
        <div
          style="
          margin: 2px 0 6px 8px; padding: 6px 10px;
          border-radius: 4px 0 0 4px; cursor: pointer;
          display: flex; align-items: center; gap: 6px;
          background: {$currentView === 'home'
            ? $theme.bg
            : hoveredSection === 'dashboard'
              ? 'rgba(255,255,255,0.02)'
              : 'transparent'};
        "
          role="button"
          tabindex="0"
          on:click={goHome}
          on:keydown={(e) => {
            if (e.key === "Enter") goHome();
          }}
          on:mouseenter={() => (hoveredSection = "dashboard")}
          on:mouseleave={() => {
            if (hoveredSection === "dashboard") hoveredSection = null;
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill={$currentView === "home" ? $theme.fg : $theme.fgDim}
          >
            <rect x="1" y="1" width="6" height="6" rx="1" /><rect
              x="9"
              y="1"
              width="6"
              height="6"
              rx="1"
            />
            <rect x="1" y="9" width="6" height="6" rx="1" /><rect
              x="9"
              y="9"
              width="6"
              height="6"
              rx="1"
            />
          </svg>
          <span
            style="
          font-size: 12px; font-weight: {$currentView === 'home'
              ? '600'
              : '400'};
          color: {$currentView === 'home' ? $theme.fg : $theme.fgMuted};
        ">Dashboard</span
          >
        </div>

        <!-- Terminals section header -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          style="padding: 6px 12px 2px; margin: 12px 0 0; font-size: 10px; font-weight: 600; color: {$theme.fgDim}; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between; cursor: default;"
          on:mouseenter={() => (hoveredSection = "terminals")}
          on:mouseleave={() => {
            if (hoveredSection === "terminals") hoveredSection = null;
          }}
        >
          <span>Terminals</span>
          <button
            style="background: {$theme.accent}; border: 1px solid {$theme.accent}; color: white; cursor: pointer; font-size: 10px; padding: 1px 6px; border-radius: 3px; -webkit-app-region: no-drag; font-weight: 500; visibility: {hoveredSection ===
            'terminals'
              ? 'visible'
              : 'hidden'};"
            title="New Terminal"
            on:click|stopPropagation={onNewFloatingWorkspace}>Add</button
          >
        </div>

        <!-- Floating workspaces (not attached to any project) -->
        {#each $floatingWorkspaces as { ws, idx }, localIdx (ws.id)}
          {@const hovered = hoveredWsIdx === idx}
          {@const floatingAgg = getAggregatedHarnessStatus(ws)}
          {#if insertIndicator?.scope === "floating" && insertIndicator.localIdx === localIdx && insertIndicator.edge === "before"}
            <div
              style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
            ></div>
          {/if}
          <div
            style="
            margin: 3px 0 3px 12px;
            padding: 5px 10px; border-radius: 4px 0 0 4px; cursor: {dragActive
              ? 'grabbing'
              : 'pointer'};
            display: flex; flex-direction: column; gap: {floatingAgg
              ? '2px'
              : '0'};
            border-left: 2px solid {idx === $activeWorkspaceIdx &&
            $currentView === 'workspace'
              ? $theme.fgMuted
              : $theme.fgMuted + '30'};
            background: {idx === $activeWorkspaceIdx &&
            $currentView === 'workspace'
              ? $theme.bg
              : hovered
                ? 'rgba(255,255,255,0.02)'
                : 'transparent'};
            opacity: {dragActive &&
            dragSource?.kind === 'ws' &&
            dragSource.localIdx === localIdx &&
            dragSource.scope === 'floating'
              ? '0.4'
              : '1'};
            position: relative;
          "
            role="button"
            tabindex="0"
            data-drag-scope="floating"
            data-drag-idx={localIdx}
            on:click={() => {
              if (!dragActive) handleWorkspaceClick(idx);
            }}
            on:keydown={(e) => {
              if (e.key === "Enter") handleWorkspaceClick(idx);
            }}
            on:mouseenter={() => (hoveredWsIdx = idx)}
            on:mouseleave={() => {
              if (hoveredWsIdx === idx) hoveredWsIdx = null;
            }}
            on:mousedown={(e) =>
              startDrag(e, { kind: "ws", scope: "floating", localIdx })}
          >
            {#if hovered}
              <button
                style="position: absolute; top: 4px; right: 4px; background: none; border: none; color: {$theme.fgDim}; cursor: pointer; padding: 0 2px; font-size: 14px; line-height: 1; -webkit-app-region: no-drag; z-index: 1;"
                title="Close workspace"
                on:click|stopPropagation={() => onCloseWorkspace(idx)}
                >&times;</button
              >
            {/if}
            {#if floatingAgg}
              <div
                style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: {statusColor(
                  floatingAgg.primary,
                )}; white-space: nowrap; overflow: hidden; min-width: 0;"
                title={harnessTooltip(floatingAgg)}
              >
                <span
                  style="font-family: monospace; width: 10px; text-align: center; flex-shrink: 0;"
                  >{statusIndicator(floatingAgg.primary)}</span
                >
                <span style="overflow: hidden; text-overflow: ellipsis;"
                  >Claude: {floatingAgg.primary}</span
                >
                {#if floatingAgg.total > 1}
                  <span
                    style="font-size: 9px; padding: 0 4px; border-radius: 8px; background: {statusColor(
                      floatingAgg.primary,
                    )}20; flex-shrink: 0;">{floatingAgg.total}</span
                  >
                {/if}
              </div>
            {/if}
            <span
              style="
            font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            font-weight: {idx === $activeWorkspaceIdx ? '600' : '400'};
            color: {idx === $activeWorkspaceIdx ? $theme.fg : $theme.fgMuted};
          ">{ws.name}</span
            >
          </div>
          {#if insertIndicator?.scope === "floating" && insertIndicator.localIdx === localIdx && insertIndicator.edge === "after"}
            <div
              style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
            ></div>
          {/if}
        {/each}

        <!-- Projects section header -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          style="padding: 6px 12px 2px; margin: 12px 0 0; font-size: 10px; font-weight: 600; color: {$theme.fgDim}; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between; cursor: default;"
          on:mouseenter={() => (hoveredSection = "projects")}
          on:mouseleave={() => {
            if (hoveredSection === "projects") hoveredSection = null;
          }}
        >
          <span>Projects</span>
          <button
            style="background: {$theme.accent}; border: 1px solid {$theme.accent}; color: white; cursor: pointer; font-size: 10px; padding: 1px 6px; border-radius: 3px; -webkit-app-region: no-drag; font-weight: 500; visibility: {hoveredSection ===
            'projects'
              ? 'visible'
              : 'hidden'};"
            title="New Project"
            on:click|stopPropagation={onAddProject}>Add</button
          >
        </div>

        <!-- Active projects -->
        {#each $activeProjects as project, projectIdx (project.id)}
          {@const projectWs = $projectWorkspaceMap.get(project.id) || []}
          {#if insertIndicator?.scope === "__projects__" && insertIndicator.localIdx === projectIdx && insertIndicator.edge === "before"}
            <div
              style="height: 2px; background: {$theme.accent}; margin: 0 4px; border-radius: 1px;"
            ></div>
          {/if}
          <div data-project-block={projectIdx}>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              style="
            padding: 5px 10px 2px; margin: 0 0 0 4px;
            border-radius: 4px 0 0 4px;
            font-size: 12px; font-weight: 600;
            color: {$theme.fgMuted}; display: flex; align-items: center;
            justify-content: space-between; cursor: {dragActive
                ? 'grabbing'
                : 'pointer'};
            background: {$currentView === 'project' &&
              $currentProjectId === project.id
                ? $theme.bg
                : hoveredProject === project.id
                  ? 'rgba(255,255,255,0.02)'
                  : 'transparent'};
            opacity: {dragActive &&
              dragSource?.kind === 'proj' &&
              dragSource.idx === projectIdx
                ? '0.4'
                : '1'};
          "
              data-drag-scope="__projects__"
              data-drag-idx={projectIdx}
              on:click={() => {
                if (!dragActive) goToProject(project.id);
              }}
              on:mouseenter={() => (hoveredProject = project.id)}
              on:mouseleave={() => {
                if (hoveredProject === project.id) hoveredProject = null;
              }}
              on:mousedown={(e) =>
                startDrag(e, { kind: "proj", idx: projectIdx })}
            >
              <span
                style="display: flex; align-items: center; gap: 5px; color: {project.color ||
                  $theme.fgMuted};"
              >
                {#if project.gitBacked}
                  <span
                    style="
                width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;
                background: {project.color || $theme.fgMuted}; display: flex;
                align-items: center; justify-content: center;
              "
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 16 16"
                      fill={$theme.sidebarBg}
                      style="flex-shrink: 0;"
                    >
                      <path
                        d="M15.698 7.287L8.712.302a1.03 1.03 0 00-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 011.55 1.56l1.773 1.774a1.224 1.224 0 011.267 2.025 1.226 1.226 0 01-1.737-1.726L8.78 5.507v4.16a1.226 1.226 0 11-.943.057V5.39a1.225 1.225 0 01-.665-1.607L5.38 1.99.302 7.068a1.03 1.03 0 000 1.457l6.986 6.986a1.03 1.03 0 001.457 0l6.953-6.953a1.031 1.031 0 000-1.271z"
                      />
                    </svg>
                  </span>
                {/if}
                {project.name}
              </span>
              {#if hoveredProject === project.id}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  title="New workspace"
                  style="color: {$theme.fgDim}; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; -webkit-app-region: no-drag;"
                  on:click|stopPropagation={() => onNewWorkspace(project.id)}
                  >+</span
                >
              {/if}
            </div>

            {#each projectWs as { ws, idx }, localIdx (ws.id)}
              {@const hovered = hoveredWsIdx === idx}
              {@const isManaged = ws.record?.type === "managed"}
              {@const color = project.color || $theme.accent}
              {@const harness = getAggregatedHarnessStatus(ws)}
              {@const stats = isManaged ? gitStatusCache.get(ws.id) : null}
              {@const isDragged =
                dragActive &&
                dragSource?.kind === "ws" &&
                dragSource.localIdx === localIdx &&
                dragSource.scope === project.id}

              {#if insertIndicator?.scope === project.id && insertIndicator.localIdx === localIdx && insertIndicator.edge === "before"}
                <div
                  style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
                ></div>
              {/if}

              {#if isManaged}
                <!-- Managed workspace: rich card -->
                <div
                  data-ws-entry=""
                  style="
                  margin: 3px 0 3px 12px;
                  padding: 6px 10px; border-radius: 4px 0 0 4px; cursor: {dragActive
                    ? 'grabbing'
                    : 'pointer'};
                  border-left: 2px solid {idx === $activeWorkspaceIdx &&
                  $currentView === 'workspace'
                    ? color
                    : color + '30'};
                  background: {idx === $activeWorkspaceIdx &&
                  $currentView === 'workspace'
                    ? $theme.bg
                    : hovered
                      ? 'rgba(255,255,255,0.02)'
                      : 'transparent'};
                  opacity: {isDragged ? '0.4' : '1'};
                  display: flex; flex-direction: column; gap: 3px; position: relative;
                "
                  role="button"
                  tabindex="0"
                  data-drag-scope={project.id}
                  data-drag-idx={localIdx}
                  on:click={() => {
                    if (!dragActive) handleWorkspaceClick(idx);
                  }}
                  on:keydown={(e) => {
                    if (e.key === "Enter") handleWorkspaceClick(idx);
                  }}
                  on:mouseenter={() => (hoveredWsIdx = idx)}
                  on:mouseleave={() => {
                    if (hoveredWsIdx === idx) hoveredWsIdx = null;
                  }}
                  on:mousedown={(e) =>
                    startDrag(e, { kind: "ws", scope: project.id, localIdx })}
                  on:contextmenu|preventDefault={(e) =>
                    showWorkspaceContextMenu(
                      e.clientX,
                      e.clientY,
                      idx,
                      project.id,
                    )}
                >
                  {#if hovered}
                    <button
                      style="position: absolute; top: 4px; right: 4px; background: none; border: none; color: {$theme.fgDim}; cursor: pointer; padding: 0 2px; font-size: 14px; line-height: 1; -webkit-app-region: no-drag; z-index: 1;"
                      title="Close workspace"
                      on:click|stopPropagation={() => onCloseWorkspace(idx)}
                      >&times;</button
                    >
                  {/if}
                  {#if harness}
                    <div
                      style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: {statusColor(
                        harness.primary,
                      )}; white-space: nowrap; overflow: hidden; min-width: 0;"
                      title={harnessTooltip(harness)}
                    >
                      <span
                        style="font-family: monospace; width: 10px; text-align: center; flex-shrink: 0;"
                        >{statusIndicator(harness.primary)}</span
                      >
                      <span style="overflow: hidden; text-overflow: ellipsis;"
                        >Claude: {harness.primary}</span
                      >
                      {#if harness.total > 1}
                        <span
                          style="font-size: 9px; padding: 0 4px; border-radius: 8px; background: {statusColor(
                            harness.primary,
                          )}20; flex-shrink: 0;">{harness.total}</span
                        >
                      {/if}
                    </div>
                  {/if}

                  <!-- Branch name -->
                  <div
                    style="display: flex; align-items: center; gap: 4px; font-size: 12px;"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 16 16"
                      fill={idx === $activeWorkspaceIdx
                        ? $theme.fg
                        : $theme.fgMuted}
                      style="flex-shrink: 0; opacity: 0.7;"
                    >
                      <path
                        d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25z"
                      />
                    </svg>
                    <span
                      style="
                    font-weight: {idx === $activeWorkspaceIdx ? '600' : '500'};
                    color: {idx === $activeWorkspaceIdx
                        ? $theme.fg
                        : $theme.fgMuted};
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
                  ">{ws.record?.branch || ws.name}</span
                    >
                  </div>

                  <!-- Git stats + age -->
                  <div
                    style="display: flex; align-items: center; gap: 6px; font-size: 10px;"
                  >
                    {#if stats && (stats.added > 0 || stats.modified > 0 || stats.deleted > 0)}
                      <span
                        style="display: flex; align-items: center; gap: 4px; flex: 1;"
                      >
                        {#if stats.added > 0}
                          <span style="color: {$theme.ansi.green};"
                            >+{stats.added}</span
                          >
                        {/if}
                        {#if stats.modified > 0}
                          <span style="color: {$theme.ansi.blue};"
                            >~{stats.modified}</span
                          >
                        {/if}
                        {#if stats.deleted > 0}
                          <span style="color: {$theme.ansi.red};"
                            >-{stats.deleted}</span
                          >
                        {/if}
                      </span>
                    {:else}
                      <span style="flex: 1;"></span>
                    {/if}
                    {#if ws.record?.createdAt}
                      <span style="color: {$theme.fgDim}; flex-shrink: 0;"
                        >{relativeAge(ws.record.createdAt)}</span
                      >
                    {/if}
                  </div>
                </div>
              {:else}
                <!-- Terminal workspace: simple row -->
                <div
                  data-ws-entry=""
                  style="
                  margin: 3px 0 3px 12px;
                  padding: 5px 10px; border-radius: 4px 0 0 4px; cursor: pointer;
                  border-left: 2px solid {idx === $activeWorkspaceIdx &&
                  $currentView === 'workspace'
                    ? color
                    : color + '30'};
                  display: flex; flex-direction: column; gap: {harness
                    ? '2px'
                    : '0'}; position: relative;
                  background: {idx === $activeWorkspaceIdx &&
                  $currentView === 'workspace'
                    ? $theme.bg
                    : hovered
                      ? 'rgba(255,255,255,0.02)'
                      : 'transparent'};
                  opacity: {isDragged
                    ? '0.4'
                    : ws.record?.status === 'stashed'
                      ? '0.6'
                      : '1'};
                "
                  role="button"
                  tabindex="0"
                  data-drag-scope={project.id}
                  data-drag-idx={localIdx}
                  on:click={() => {
                    if (!dragActive) handleWorkspaceClick(idx);
                  }}
                  on:keydown={(e) => {
                    if (e.key === "Enter") handleWorkspaceClick(idx);
                  }}
                  on:mouseenter={() => (hoveredWsIdx = idx)}
                  on:mouseleave={() => {
                    if (hoveredWsIdx === idx) hoveredWsIdx = null;
                  }}
                  on:mousedown={(e) =>
                    startDrag(e, { kind: "ws", scope: project.id, localIdx })}
                  on:contextmenu|preventDefault={(e) =>
                    showWorkspaceContextMenu(
                      e.clientX,
                      e.clientY,
                      idx,
                      project.id,
                    )}
                >
                  {#if hovered}
                    <button
                      style="position: absolute; top: 4px; right: 4px; background: none; border: none; color: {$theme.fgDim}; cursor: pointer; padding: 0 2px; font-size: 14px; line-height: 1; -webkit-app-region: no-drag; z-index: 1;"
                      title="Close workspace"
                      on:click|stopPropagation={() => onCloseWorkspace(idx)}
                      >&times;</button
                    >
                  {/if}
                  {#if harness}
                    <div
                      style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: {statusColor(
                        harness.primary,
                      )}; white-space: nowrap; overflow: hidden; min-width: 0;"
                      title={harnessTooltip(harness)}
                    >
                      <span
                        style="font-family: monospace; width: 10px; text-align: center; flex-shrink: 0;"
                        >{statusIndicator(harness.primary)}</span
                      >
                      <span style="overflow: hidden; text-overflow: ellipsis;"
                        >Claude: {harness.primary}</span
                      >
                      {#if harness.total > 1}
                        <span
                          style="font-size: 9px; padding: 0 4px; border-radius: 8px; background: {statusColor(
                            harness.primary,
                          )}20; flex-shrink: 0;">{harness.total}</span
                        >
                      {/if}
                    </div>
                  {/if}
                  <span
                    style="
                  font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                  font-weight: {idx === $activeWorkspaceIdx ? '600' : '400'};
                  color: {idx === $activeWorkspaceIdx
                      ? $theme.fg
                      : $theme.fgMuted};
                ">{ws.name}</span
                  >
                </div>
              {/if}
              {#if insertIndicator?.scope === project.id && insertIndicator.localIdx === localIdx && insertIndicator.edge === "after"}
                <div
                  style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
                ></div>
              {/if}
            {/each}
          </div>
          <!-- /data-project-block -->
          {#if insertIndicator?.scope === "__projects__" && insertIndicator.localIdx === projectIdx && insertIndicator.edge === "after"}
            <div
              style="height: 2px; background: {$theme.accent}; margin: 0 4px; border-radius: 1px;"
            ></div>
          {/if}
        {/each}
      </div>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="resize-handle"
      style="
      width: 4px; cursor: col-resize; flex-shrink: 0;
      background: {dragging ? $theme.accent : 'transparent'};
    "
      on:mousedown={startResize}
    ></div>
  </div>
{/if}

<style>
  .resize-handle:hover {
    background: rgba(255, 255, 255, 0.08) !important;
  }
</style>
