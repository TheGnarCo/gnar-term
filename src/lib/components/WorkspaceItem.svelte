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
  import DragGrip from "./DragGrip.svelte";

  $: isDisco = $theme.name === "Molly Disco";
  import { getAllSurfaces, getAllPanes } from "../types";
  import type { Workspace } from "../types";

  const discoEmojis = [
    "✨",
    "🦄",
    "🌈",
    "💜",
    "🪩",
    "⚡",
    "💫",
    "🔮",
    "🎀",
    "💎",
    "🌸",
    "🍭",
    "🫧",
    "💗",
    "🦋",
    "🎠",
    "🧚",
    "💖",
    "🌺",
    "🎵",
    "🩵",
    "🪻",
    "🎪",
    "🧸",
    "🌟",
    "💐",
    "🩷",
    "🏄",
    "🐬",
    "🌊",
    "🎨",
    "🧜",
    "🫶",
    "💕",
    "🌙",
    "🐾",
    "🍬",
    "🎶",
    "🌻",
    "🐱",
    "💝",
    "🎈",
    "🪼",
    "🦩",
    "🫀",
    "🧁",
    "🍩",
    "🎯",
  ];
  const discoColors = [
    "#e91e63",
    "#c026d3",
    "#2979ff",
    "#00bfa5",
    "#ff4081",
    "#e040fb",
    "#448aff",
    "#1de9b6",
    "#ff9100",
    "#18ffff",
  ];

  // Stable emoji per workspace based on id hash
  function discoEmojiFor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return discoEmojis[Math.abs(h) % discoEmojis.length] ?? "";
  }
  function discoColorFor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 37 + id.charCodeAt(i)) | 0;
    return discoColors[Math.abs(h) % discoColors.length] ?? "";
  }

  export let workspace: Workspace;
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

  let hovered = false;
  let closeHovered = false;
  let nameEl: HTMLSpanElement;
  let _renaming = false;

  $: allSurfaces = getAllSurfaces(workspace);
  $: hasUnread = allSurfaces.some((s) => s.hasUnread);
  $: latestNotification = allSurfaces.find((s) => s.notification)?.notification;
  $: isManaged = !!workspace.metadata?.worktreePath;
  $: dashboardWorkspaceEntry = (() => {
    const id = (workspace.metadata as Record<string, unknown> | undefined)
      ?.dashboardWorkspaceId;
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
  $: isDashboardWs =
    (workspace.metadata as Record<string, unknown> | undefined)?.isDashboard ===
    true;
  $: isDashboardWorkspaceRow = dashboardWorkspaceIcon !== null;
  // Nested workspaces live under a group's colored banner. The group
  // banner itself already rolls up status (and the per-row chip handles
  // agent state), so the long blue notification row duplicates chrome
  // and crowds the nested layout — suppress it in that context.
  $: isInsideGroup =
    typeof (workspace.metadata as Record<string, unknown> | undefined)
      ?.groupId === "string";
  $: isAgentSpawned = (() => {
    const md = workspace.metadata as Record<string, unknown> | undefined;
    if (!md) return false;
    return (
      (typeof md.spawnedBy === "object" && md.spawnedBy !== null) ||
      typeof md.parentOrchestratorId === "string"
    );
  })();
  $: railColor =
    (isDashboardWorkspaceRow && dashboardWorkspaceEntry?.accentColor) ||
    accentColor ||
    $theme.accent;
  // Status registry subscriptions (process items for agent dots)
  $: processStatusStore = getWorkspaceStatusByCategory(workspace.id, "process");
  $: processItems = $processStatusStore;
  $: agentBadges = aggregateAgentBadges(processItems);
  $: agentChipColor = agentBadges.length > 0 ? agentBadges[0]?.color : null;

  $: activePaneInWs = getAllPanes(workspace.splitRoot).find(
    (p) => p.id === workspace.activePaneId,
  );
  $: activeSurfaceForAgent = (() => {
    const sid = activePaneInWs?.activeSurfaceId;
    if (!sid) return null;
    const hasAgent = processItems.some(
      (item) =>
        (item.metadata as Record<string, unknown> | undefined)?.surfaceId ===
        sid,
    );
    return hasAgent ? (allSurfaces.find((s) => s.id === sid) ?? null) : null;
  })();

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  data-drag-idx={index}
  data-workspace-id={workspace.id}
  data-worktree={isManaged ? "true" : undefined}
  style="
    display: {dragActive ? 'none' : 'flex'};
    position: relative;
    margin: 0 8px 0 0; border-radius: 0 6px 6px 0; overflow: hidden; cursor: pointer;
    background: {isActive
    ? $theme.bgActive
    : hovered
      ? $theme.bgHighlight
      : ($theme.bgSurface ?? 'transparent')};
    border: 1px solid {isActive ? railColor : ($theme.border ?? 'transparent')};
  "
  on:contextmenu|preventDefault={(e) => {
    // Dashboards are non-interactive surfaces; right-click is a no-op.
    if (isDashboardWs) return;
    onContextMenu(e.clientX, e.clientY);
  }}
  on:mouseenter={() => (hovered = true)}
  on:mouseleave={() => {
    hovered = false;
    closeHovered = false;
  }}
  on:mousedown={(e) => onGripMouseDown?.(e)}
>
  {#if onGripMouseDown}
    <!-- Grip column. The drag-start handler lives on the outer row
         div (above) so hovering anywhere on the row expands the grip
         and mousedowns on the body itself initiate the reorder —
         createDragReorder's 5px threshold keeps taps as selects. -->
    <DragGrip
      theme={$theme}
      visible={dragActive || (hovered && !$anyReorderActive)}
      {railColor}
      railOpacity={1}
      alwaysShowDots={true}
      fadeRight={!(dragActive || (hovered && !$anyReorderActive))}
    />
    <!-- Drag-edge fade: continues the rail's dot pattern from the
         very left of the row into the row body for ~14px, dropping
         off fast. Matches the project banner's fade treatment so
         the rail → row-body transition reads as a gradient rather
         than a hard edge. Independent of expansion state. -->
    <div
      aria-hidden="true"
      style="
        position: absolute;
        top: 0; bottom: 0;
        left: 0; width: 14px;
        pointer-events: none;
        background-image:
          radial-gradient(circle, {railColor} 1.1px, transparent 1.6px),
          radial-gradient(circle, {railColor} 1.1px, transparent 1.6px);
        background-size: 5px 5px;
        background-position: 0 0, 2.5px 2.5px;
        background-repeat: repeat;
        -webkit-mask-image: linear-gradient(
          to right,
          rgba(0, 0, 0, 1) 0%,
          rgba(0, 0, 0, 0.3) 20%,
          rgba(0, 0, 0, 0) 70%
        );
        mask-image: linear-gradient(
          to right,
          rgba(0, 0, 0, 1) 0%,
          rgba(0, 0, 0, 0.3) 20%,
          rgba(0, 0, 0, 0) 70%
        );
      "
    ></div>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div on:click={onSelect} style="flex: 1; min-width: 0; padding-right: 24px;">
    <div
      style="padding: 4px 6px; display: flex; align-items: center; gap: 8px;"
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
        {#if isManaged}
          <span
            data-workspace-worktree-icon
            title="Git worktree workspace"
            style="
              flex-shrink: 0; display: inline-flex; align-items: center;
              justify-content: center; color: {railColor};
            "
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <title>Git worktree workspace</title>
              <circle cx="4" cy="4" r="2" />
              <circle cx="4" cy="12" r="2" />
              <circle cx="12" cy="8" r="2" />
              <path d="M4 6 L4 10" />
              <path d="M6 4 C8 4 10 6 10 8" />
            </svg>
          </span>
        {/if}
        {#if dashboardHint}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            data-workspace-dashboard-icon
            data-dashboard-id={dashboardHint.id}
            title="Open owning dashboard"
            on:click|stopPropagation={() => dashboardHint?.onClick()}
            style="
              flex-shrink: 0; display: inline-flex; align-items: center;
              justify-content: center; width: 14px; height: 14px;
              color: {dashboardHint.color ?? $theme.fgDim}; cursor: pointer;
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
          </span>
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

      {#if !hideStatusBadges}
        {#if agentBadges.length > 0 && agentBadges[0]}
          <span
            data-agent-presence-chip
            title={[latestNotification].filter(Boolean).join(" — ")}
            style="display: inline-flex; align-items: center; padding: 0 3px; flex-shrink: 0;"
          >
            <span
              style="width: 7px; height: 7px; border-radius: 50%; background: {agentChipColor}; box-shadow: 0 0 0 1px color-mix(in srgb, {agentChipColor} 35%, transparent);"
            ></span>
          </span>
        {/if}

        {#if hasUnread && agentBadges.length === 0}
          <span
            title="Workspace has new terminal activity"
            style="display: inline-flex; align-items: center; padding: 0 3px; flex-shrink: 0;"
          >
            <span
              style="width: 6px; height: 6px; border-radius: 50%; background: {$theme.notify}; box-shadow: 0 0 0 1px color-mix(in srgb, {$theme.notify} 35%, transparent);"
            ></span>
          </span>
        {/if}
      {/if}
    </div>

    {#each isDashboardWorkspaceRow ? [] : subtitleComponents as sub (sub.id)}
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

    {#if !hideStatusBadges && activeSurfaceForAgent?.title}
      <div
        data-harness-title-row
        style="padding: 0 12px 4px 6px; display: flex; align-items: center; min-width: 0; overflow: hidden; line-height: 1.2;"
      >
        <span
          style="font-size: 10px; color: {$theme.fgDim}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; display: inline-flex; align-items: center; gap: 3px;"
          title={activeSurfaceForAgent.title}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke={railColor}
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="flex-shrink: 0; opacity: 0.7;"
          >
            <title>Active harness session</title>
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
          {activeSurfaceForAgent.title}
        </span>
      </div>
    {/if}

    {#if latestNotification && !hideStatusBadges && !isInsideGroup && !agentChipColor}
      <div
        style="padding: 2px 12px 6px 6px; font-size: 11px; color: {$theme.notify}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
      >
        {latestNotification}
      </div>
    {/if}
  </div>
  <!-- Close button: absolutely positioned so it stays vertically
       centered against the full row regardless of how many subtitle or
       notification rows stack below the title. The content column
       reserves 24px on the right to keep text from crashing into it. -->
  {#if !isDashboardWs || isDashboardWorkspaceRow}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <span
      title="Close Workspace (⇧⌘W)"
      style="
        position: absolute;
        top: 50%; right: 6px;
        transform: translateY(-50%);
        color: {closeHovered ? $theme.danger : $theme.fgDim};
        font-size: 14px; cursor: pointer;
        opacity: {hovered ? '1' : '0'}; transition: opacity 0.15s;
        padding: 0 2px;
      "
      on:click|stopPropagation={onClose}
      on:mouseenter={() => (closeHovered = true)}
      on:mouseleave={() => (closeHovered = false)}>×</span
    >
  {/if}
</div>
