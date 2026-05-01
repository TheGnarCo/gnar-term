<script lang="ts">
  import { tick, type Component } from "svelte";
  import { theme } from "../stores/theme";
  import { anyReorderActive } from "../stores/ui";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import { dashboardWorkspaceRegistry } from "../services/dashboard-workspace-service";
  import { aggregateAgentBadges } from "../status-colors";
  import { workspaceSubtitleStore } from "../services/workspace-subtitle-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import PrimarySidebarElement from "./PrimarySidebarElement.svelte";
  import WorktreeIcon from "../icons/WorktreeIcon.svelte";
  import { modLabel } from "../terminal-service";
  import { discoEmojiFor, discoColorFor } from "../utils/disco-decoration";

  $: isDisco = $theme.name === "Molly Disco";
  import { getAllSurfaces } from "../types";
  import type { NestedWorkspace } from "../types";
  import { workspaceSurfaceMap } from "../services/workspace-service";
  import { wsMeta } from "../services/service-helpers";

  export let workspace: NestedWorkspace;
  export let index: number;
  export let isActive: boolean;
  export let onSelect: () => void;
  export let onClose: () => void;
  export let onRename: (name: string) => void;
  export let onContextMenu: (x: number, y: number) => void;
  /** Project accent color — when set, overrides the default border-left styling. */
  export let accentColor: string | undefined = undefined;
  /**
   * Optional hint that this workspace belongs to a dashboard. Adds a small
   * clickable icon inside the row that navigates to the owning dashboard
   * without selecting the workspace itself.
   */
  export let dashboardHint:
    | { id: string; color?: string; onClick: () => void }
    | undefined = undefined;
  /**
   * Suppress per-workspace status chrome (unread, agent badges, latest
   * notification). Used when the workspace is rendered inside a
   * container that aggregates status itself — e.g. nested under an
   * AgentDashboardRow whose banner already rolls up detected-agent
   * activity. Projects leave this false so their nested workspaces
   * keep showing their own status.
   */
  export let hideStatusBadges: boolean = false;
  /** When true, this workspace is nested inside a container group and should always show the close button. */
  export let isNested: boolean = false;
  /** Sidebar position index for the ⌘N shortcut hint. */
  export let shortcutIdx: number | undefined = undefined;

  let nameEl: HTMLSpanElement;
  let _renaming = false;

  $: allSurfaces =
    $workspaceSurfaceMap.get(workspace.id) ?? getAllSurfaces(workspace);
  $: hasUnread = allSurfaces.some((s) => s.hasUnread);
  $: latestNotification = allSurfaces.find((s) => s.notification)?.notification;
  $: isManaged = !!workspace.metadata?.worktreePath;
  $: worktreeDirName = (() => {
    const path = workspace.metadata?.worktreePath;
    if (!path) return "";
    const parts = path.split("/").filter((p) => p.length > 0);
    return parts[parts.length - 1] || "";
  })();
  $: shouldShowWorktreeStatus =
    isManaged && worktreeDirName && worktreeDirName !== workspace.name;
  $: dashboardWorkspaceEntry = (() => {
    const id = wsMeta(workspace).dashboardWorkspaceId;
    if (typeof id !== "string") return null;
    return $dashboardWorkspaceRegistry.get(id) ?? null;
  })();
  $: dashboardWorkspaceIcon = dashboardWorkspaceEntry?.icon ?? null;
  // Workspaces spawned by a dashboard (Global Agentic or per-group)
  // get a bot marker so they're visually distinguishable from plain
  // group workspaces or worktrees. `metadata.spawnedBy` is the §3.2
  // marker; `parentOrchestratorId` is the pre-migration field we still
  // honor until Stage 8 rewrites legacy user data.
  // Dashboards are singleton surfaces bound to their group; suppress
  // close / rename / right-click affordances so the user interacts
  // with them only via the group's tile.
  $: isDashboardWs = wsMeta(workspace).isDashboard === true;
  $: isDashboardWorkspaceRow = dashboardWorkspaceIcon !== null;
  // Locked workspaces: drag-start is suppressed at the row level,
  // close affordance is hidden in the grip, and the rail shows a
  // lock chip in place of the close button.
  $: isLocked = wsMeta(workspace).locked === true;
  // Nested workspaces live under a group's colored banner. The group
  // banner itself already rolls up status (and the per-row chip handles
  // agent state), so the long blue notification row duplicates chrome
  // and crowds the nested layout — suppress it in that context.
  $: isInsideGroup = typeof wsMeta(workspace).groupId === "string";
  $: isAgentSpawned = wsMeta(workspace).spawnedBy != null;
  $: railColor =
    (isDashboardWorkspaceRow && dashboardWorkspaceEntry?.accentColor) ||
    accentColor ||
    $theme.accent;
  // Status registry subscriptions (process items for agent dots)
  $: processStatusStore = getWorkspaceStatusByCategory(workspace.id, "process");
  $: processItems = $processStatusStore;
  $: agentBadges = aggregateAgentBadges(processItems);

  $: subtitleComponents = $workspaceSubtitleStore;

  export async function startRename() {
    _renaming = true;
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
    _renaming = false;
  }

  export let dragActive = false;
  /** Mousedown handler fired when the drag grip is pressed. Drag origin, not row body. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
</script>

<PrimarySidebarElement
  isGroup={false}
  isCompact={isDashboardWs}
  {isNested}
  name={workspace.name}
  {isActive}
  {isLocked}
  isDragging={dragActive}
  canDrag={!!onGripMouseDown}
  canClose={true}
  color={railColor}
  dataDragIdx={index}
  dataWorkspaceId={workspace.id}
  dataWorktree={isManaged ? "true" : undefined}
  shortcutLabel={shortcutIdx !== undefined && shortcutIdx < 9
    ? `${modLabel}${shortcutIdx + 1}`
    : undefined}
  {onGripMouseDown}
  {onClose}
  onContextMenu={(e) => {
    // Dashboards are non-interactive surfaces; right-click is a no-op.
    if (isDashboardWs) return;
    onContextMenu(e.clientX, e.clientY);
  }}
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="button"
    tabindex="0"
    data-workspace-content
    on:click={onSelect}
    on:keydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    }}
    style="flex: 1; min-width: 0;"
  >
    <div
      style="padding: 0 24px 0 2px; display: flex; align-items: center; gap: 8px;"
    >
      <div
        style="flex: 1; overflow: hidden; display: flex; align-items: center; gap: 4px;"
      >
        {#if isAgentSpawned}
          <span
            data-workspace-agent-icon
            title="Spawned by agent dashboard"
            style="
              flex-shrink: 0; display: inline-flex; align-items: center;
              justify-content: center; color: {railColor};
            "
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <title>Agent-spawned workspace</title>
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
          </span>
        {/if}
        {#if isManaged && !shouldShowWorktreeStatus}
          <span
            data-workspace-worktree-icon
            title="Git worktree workspace"
            style="
              flex-shrink: 0; display: inline-flex; align-items: center;
              justify-content: center; color: {railColor};
            "
          >
            <WorktreeIcon size={12} />
          </span>
        {/if}
        {#if dashboardHint}
          <button
            data-workspace-dashboard-icon
            data-dashboard-id={dashboardHint.id}
            aria-label="Open owning dashboard"
            on:click|stopPropagation={() => dashboardHint?.onClick()}
            style="
              flex-shrink: 0; display: inline-flex; align-items: center;
              justify-content: center; width: 14px; height: 14px;
              color: {dashboardHint.color ?? $theme.fgDim}; cursor: pointer;
              background: none; border: none; padding: 0;
            "
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <title>Open dashboard</title>
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
          </button>
        {/if}
        {#if dashboardWorkspaceIcon}
          <span
            style="
              flex-shrink: 0; display: inline-flex; align-items: center;
              justify-content: center; width: 14px; height: 14px;
              color: {railColor};
            "
            aria-hidden="true"
          >
            <svelte:component
              this={dashboardWorkspaceIcon}
              width={12}
              height={12}
            />
          </span>
        {/if}
        <span
          bind:this={nameEl}
          role="textbox"
          aria-label="Workspace name"
          aria-multiline="false"
          tabindex="-1"
          style="
            font-weight: {isActive ? '600' : '400'};
            color: {isDisco
            ? discoColorFor(workspace.id)
            : isActive
              ? $theme.fg
              : $theme.fgMuted};
            font-size: 13px; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap;
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
          >{#if isDisco}{discoEmojiFor(workspace.id)}
          {/if}{workspace.name}</span
        >
      </div>

      {#if !hideStatusBadges && hasUnread && agentBadges.length === 0}
        <span
          title="Workspace has new terminal activity"
          style="display: inline-flex; align-items: center; padding: 0 3px; flex-shrink: 0;"
        >
          <span
            style="width: 6px; height: 6px; border-radius: 50%; background: {$theme.notify}; box-shadow: 0 0 0 1px color-mix(in srgb, {$theme.notify} 35%, transparent);"
          ></span>
        </span>
      {/if}
    </div>

    {#if !hideStatusBadges && agentBadges.length > 0 && agentBadges[0]}
      {@const badge = agentBadges[0]}
      <div
        data-harness-title-row
        title={badge.label}
        aria-hidden="true"
        style="padding: 0 12px 4px 6px; font-size: 11px; color: {badge.color}; display: flex; align-items: center; gap: 4px; overflow: hidden; opacity: 0.85;"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="flex-shrink: 0;"
        >
          <title>Active harness session</title>
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </svg>
        <span
          style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >{badge.label}</span
        >
      </div>
    {/if}

    {#if shouldShowWorktreeStatus && !hideStatusBadges}
      <div
        style="padding: 0 24px 2px 2px; font-size: 11px; color: {$theme.fgMuted}; display: flex; align-items: center; gap: 4px; overflow: hidden;"
      >
        <span style="flex-shrink: 0; display: inline-flex; color: {railColor};">
          <WorktreeIcon size={10} />
        </span>
        <span
          style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
        >
          {worktreeDirName}
        </span>
      </div>
    {/if}

    {#if !isDashboardWorkspaceRow && subtitleComponents.length > 0}
      <div
        style="padding: 0 24px 2px 2px; font-size: 11px; color: {$theme.fgMuted}; display: flex; align-items: center; gap: 4px; overflow: hidden;"
      >
        {#each subtitleComponents as sub (sub.id)}
          {@const subApi = getExtensionApiById(sub.source)}
          {#if subApi}
            <ExtensionWrapper
              api={subApi}
              component={sub.component}
              props={{ workspaceId: workspace.id, accentColor: railColor }}
            />
          {:else}
            <svelte:component
              this={sub.component as Component}
              workspaceId={workspace.id}
              accentColor={railColor}
            />
          {/if}
        {/each}
      </div>
    {/if}

    {#if latestNotification && !hideStatusBadges && !isInsideGroup && agentBadges.length === 0}
      <div
        style="padding: 2px 12px 6px 6px; font-size: 11px; color: {$theme.notify}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
      >
        {latestNotification}
      </div>
    {/if}
  </div>
</PrimarySidebarElement>
