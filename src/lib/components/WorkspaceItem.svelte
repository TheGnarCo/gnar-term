<script lang="ts">
  import { type Component } from "svelte";
  import { theme } from "../stores/theme";
  import { anyReorderActive } from "../stores/ui";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import { globalSurfaceRegistry } from "../services/global-surface-service";
  import { aggregateAgentBadges } from "../status-colors";
  import { workspaceSubtitleStore } from "../services/workspace-subtitle-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import SidebarElement from "./SidebarElement.svelte";
  import RenameableLabel from "./RenameableLabel.svelte";
  import SidebarSubtitleRow from "./SidebarSubtitleRow.svelte";
  import WorktreeIcon from "../icons/WorktreeIcon.svelte";
  import BotIcon from "../icons/BotIcon.svelte";
  import { modLabel } from "../terminal-service";
  import { discoEmojiFor, discoColorFor } from "../utils/disco-decoration";

  $: isDisco = $theme.name === "Molly Disco";
  import { getAllSurfaces, getAllPanes, isBranchedWorkspace } from "../types";
  import type { Workspace } from "../types";
  import { workspaceSurfaceMap } from "../services/workspace-runtime-service";
  import { workspacesStore } from "../stores/workspace";
  import {
    branchLifecycleStore,
    type BranchLifecycle,
  } from "../services/branch-lifecycle";
  import { agentsStore } from "../services/agent-detection-service";
  import { attentionStore } from "../services/attention-api";
  import { workspaceRailBotStatus } from "../services/rail-attention";

  export let workspace: Workspace;
  export let index: number;
  export let isActive: boolean;
  export let onSelect: () => void;
  export let onClose: () => void;
  export let onRename: (name: string) => void;
  export let onContextMenu: (x: number, y: number) => void;
  /** Workspace accent color — when set, overrides the default border-left styling. */
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
   * activity. Root Workspaces leave this false so their Branches keep
   * showing their own status.
   */
  export let hideStatusBadges: boolean = false;
  /** When true, this workspace is rendered inside a container workspace and should always show the close button. */
  export let isChild: boolean = false;
  /** Sidebar position index for the ⌘N shortcut hint. */
  export let shortcutIdx: number | undefined = undefined;

  let labelComponent: RenameableLabel;

  $: allSurfaces =
    $workspaceSurfaceMap.get(workspace.id) ?? getAllSurfaces(workspace);
  $: hasUnread = allSurfaces.some((s) => s.hasUnread);
  $: latestNotification = allSurfaces.find((s) => s.notification)?.notification;
  $: worktreePath = (workspace as { worktreePath?: string }).worktreePath;
  $: isManaged = !!worktreePath;
  $: worktreeDirName = (() => {
    if (!worktreePath) return "";
    const parts = worktreePath.split("/").filter((p) => p.length > 0);
    return parts[parts.length - 1] || "";
  })();
  $: shouldShowWorktreeStatus =
    isManaged && worktreeDirName && worktreeDirName !== workspace.name;
  $: dashboardWorkspaceEntry = (() => {
    if (workspace.isDashboard !== true) return null;
    const id = workspace.dashboardContributionId;
    if (typeof id !== "string") return null;
    return $globalSurfaceRegistry.get(id) ?? null;
  })();
  $: dashboardWorkspaceIcon = dashboardWorkspaceEntry?.icon ?? null;
  // Workspaces spawned by a dashboard (Global Agentic or per-workspace)
  // get a bot marker so they're visually distinguishable from plain
  // child workspaces or worktrees. `metadata.spawnedBy` is the §3.2
  // marker.
  // Dashboards are singleton surfaces bound to their workspace;
  // suppress close / rename / right-click affordances so the user
  // interacts with them only via the workspace's tile.
  $: isDashboardWs = workspace.isDashboard === true;
  $: isDashboardWorkspaceRow = dashboardWorkspaceIcon !== null;
  // Locked workspaces: drag-start is suppressed at the row level,
  // close affordance is hidden in the grip, and the rail shows a
  // lock chip in place of the close button.
  $: isLocked = workspace.locked === true;
  // Branches live inside a Workspace's colored banner. The banner already
  // rolls up status (and the per-row chip handles agent state), so the
  // long blue notification row duplicates chrome and crowds the Branch
  // layout — suppress it in that context.
  $: isInsideWorkspace = typeof workspace.rootWorkspaceId === "string";
  // Surface the root Workspace's path-missing flag on every Branch row
  // inside it. The Workspace banner (SidebarBanner) currently has no
  // affordance for this state — flagging it on the row makes the
  // condition discoverable from anywhere the Branch renders.
  $: rootWorkspacePathMissing = (() => {
    const rootId = workspace.rootWorkspaceId;
    if (typeof rootId !== "string") return false;
    return $workspacesStore.find((w) => w.id === rootId)?.pathMissing === true;
  })();
  $: isAgentSpawned = workspace.spawnedBy != null;
  $: agentSpawnTooltip = (() => {
    const sb = workspace.spawnedBy;
    if (!sb) return "";
    if (sb.kind === "global") return "Spawned by Global Agentic Dashboard";
    const root = $workspacesStore.find((w) => w.id === sb.rootWorkspaceId);
    return root ? `Spawned by Workspace: ${root.name}` : "Spawned by Workspace";
  })();
  $: railColor =
    (isDashboardWorkspaceRow && dashboardWorkspaceEntry?.accentColor) ||
    accentColor ||
    $theme.accent;
  // Status registry subscriptions (process items for agent dots)
  $: processStatusStore = getWorkspaceStatusByCategory(workspace.id, "process");
  $: processItems = $processStatusStore;
  $: agentBadges = aggregateAgentBadges(processItems);
  // Per-row bot status for the rail hat. Derived from the same
  // pipeline as the Root-level rootRailBotStatus so per-branch hats
  // and the collapsed-rail hat agree on precedence and stay in sync
  // with OSC-driven attention events that bypass DetectedAgent.status.
  $: rowPaneIds = workspace.paneLayout
    ? getAllPanes(workspace.paneLayout).map((p) => p.id)
    : [];
  $: rowBotStatus = workspaceRailBotStatus(
    workspace.id,
    rowPaneIds,
    $agentsStore,
    $attentionStore,
  );
  $: subtitleComponents = $workspaceSubtitleStore;

  // Branch lifecycle subtitle — populated only for Controlled
  // BranchedWorkspaces (spawned through the agentic flow). Manual
  // branches never set `controlled`, so the lifecycle pill stays
  // hidden on them — gh-derived "awaiting review" state for a hand-
  // rolled branch is not a useful signal in the sidebar. Absent when
  // the producer hasn't synced the workspace yet (e.g. mid-creation)
  // or for non-branched rows.
  $: branchLifecycleEntry = (() => {
    if (!isBranchedWorkspace(workspace)) return null;
    if (workspace.controlled !== true) return null;
    return $branchLifecycleStore.get(workspace.branch) ?? null;
  })();
  $: lifecycleDisplay = branchLifecycleEntry
    ? lifecycleLabel(branchLifecycleEntry.lifecycle)
    : "";
  $: lifecycleColor = branchLifecycleEntry
    ? lifecycleColorFor(branchLifecycleEntry.lifecycle)
    : $theme.fgMuted;

  function lifecycleLabel(state: BranchLifecycle): string {
    switch (state) {
      case "draft":
        return "draft";
      case "active":
        return "active";
      case "awaiting_review":
        return "awaiting review";
      case "in_review":
        return "in review";
      case "merged":
        return "merged";
      case "abandoned":
        return "abandoned";
    }
  }
  function lifecycleColorFor(state: BranchLifecycle): string {
    switch (state) {
      case "active":
        return $theme.accent;
      case "awaiting_review":
      case "in_review":
        return $theme.notify;
      case "merged":
      case "abandoned":
        return $theme.fgDim;
      case "draft":
      default:
        return $theme.fgMuted;
    }
  }

  export async function startRename(): Promise<void> {
    await labelComponent?.startRename();
  }

  export let dragActive = false;
  /** Mousedown handler fired when the drag grip is pressed. Drag origin, not row body. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /**
   * True while this row's collapsed-mode popover/banner is open.
   * Forwarded to SidebarElement so the rail stays full-width while the
   * banner is showing.
   */
  export let popoverActive: boolean = false;
</script>

<SidebarElement
  kind={isDashboardWs ? "dashboard" : "child"}
  compact={isChild}
  name={workspace.name}
  {isActive}
  {popoverActive}
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
  botStatus={hideStatusBadges ? "none" : rowBotStatus}
  {onGripMouseDown}
  onRailClick={onSelect}
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
      } else if (e.key === "F2" && !isDashboardWs && !isLocked) {
        e.preventDefault();
        void startRename();
      }
    }}
    style="flex: 1; min-width: 0;"
  >
    <div
      style="padding: 0 0 0 2px; display: flex; align-items: center; gap: 8px;"
    >
      <div
        style="flex: 1; overflow: hidden; display: flex; align-items: center; gap: 4px;"
      >
        {#if isManaged && !shouldShowWorktreeStatus}
          <span
            aria-hidden="true"
            data-workspace-worktree-icon
            title="Branched Workspace"
            style="
              flex-shrink: 0; display: inline-flex; align-items: center;
              justify-content: center; color: {railColor};
            "
          >
            <WorktreeIcon size={12} />
          </span>
        {/if}
        {#if isAgentSpawned}
          <span
            aria-hidden="true"
            data-workspace-agent-icon
            title={agentSpawnTooltip}
            style="
              flex-shrink: 0; display: inline-flex; align-items: center;
              justify-content: center; color: {railColor};
            "
          >
            <BotIcon size={12} />
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
        {#if isDisco}
          <span aria-hidden="true" style="flex-shrink: 0;"
            >{discoEmojiFor(workspace.id)}</span
          >
        {/if}
        <RenameableLabel
          bind:this={labelComponent}
          value={workspace.name}
          onCommit={onRename}
          ariaLabel="Workspace name"
          klass="no-default-outline"
          style="
            font-weight: {isActive ? '600' : '400'};
            color: {isDisco
            ? discoColorFor(workspace.id)
            : isActive
              ? $theme.fg
              : $theme.fgMuted};
            font-size: 13px; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap;
            padding: 2px 4px; margin-left: -4px; border-radius: 4px;
          "
        />
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

    {#if shouldShowWorktreeStatus && !hideStatusBadges}
      <SidebarSubtitleRow color={$theme.fgMuted}>
        <span style="flex-shrink: 0; display: inline-flex; color: {railColor};">
          <WorktreeIcon size={10} />
        </span>
        <span
          style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
        >
          {worktreeDirName}
        </span>
      </SidebarSubtitleRow>
    {/if}

    {#if branchLifecycleEntry && !hideStatusBadges}
      <SidebarSubtitleRow
        data-workspace-branch-lifecycle={branchLifecycleEntry.lifecycle}
        color={lifecycleColor}
        title={branchLifecycleEntry.reason ??
          `Branch lifecycle: ${lifecycleDisplay}`}
      >
        <span
          style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
        >
          {lifecycleDisplay}{#if !branchLifecycleEntry.prStateKnown}
            <span style="opacity: 0.7;"> · gh offline</span>
          {/if}
        </span>
      </SidebarSubtitleRow>
    {/if}

    {#if rootWorkspacePathMissing && !hideStatusBadges}
      <SidebarSubtitleRow
        data-workspace-path-missing
        color={$theme.danger}
        title="Workspace root path no longer exists on disk"
      >
        <span aria-hidden="true">⚠</span>
        <span
          style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >path missing</span
        >
      </SidebarSubtitleRow>
    {/if}

    {#if !isDashboardWorkspaceRow && subtitleComponents.length > 0}
      {#each subtitleComponents as sub (sub.id)}
        {@const subApi = getExtensionApiById(sub.source)}
        <SidebarSubtitleRow color={$theme.fgMuted}>
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
        </SidebarSubtitleRow>
      {/each}
    {/if}

    {#if latestNotification && !hideStatusBadges && !isInsideWorkspace && agentBadges.length === 0}
      <div
        style="padding: 2px 12px 6px 6px; font-size: 11px; color: {$theme.notify}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
      >
        {latestNotification}
      </div>
    {/if}
  </div>
</SidebarElement>
