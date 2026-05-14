<script lang="ts">
  /**
   * WorkspaceAgentSubtitle — per-Workspace agent status rendered as an
   * inline subtitle row between the workspace title and its CWD.
   *
   * Format mirrors the surrounding GitStatusLine: bot icon (colored by
   * the workspace's aggregate bot bucket) followed by the status as
   * plain lowercase text — no name, no pill. When exactly one workspace
   * branch matches a pane, the branch-lifecycle pill rides on the same
   * row.
   *
   * Scope is intentionally narrower than the rail bot-status bubble —
   * the bubble on the workspace banner aggregates the root workspace
   * AND its branched workspaces, while this inline row reports only
   * the bots whose `workspaceId` matches the row's own workspace.
   * Branched workspace rows therefore show their own scope, and the
   * root banner shows only the root's own bots even when branches
   * have activity.
   *
   * Hides itself entirely when no active agents are present (and no
   * lifecycle pill would render). Registered by core in
   * init-agent-status.ts — not an extension contribution — so the
   * visibility ships with the Workspace itself.
   */
  import { derived, get } from "svelte/store";
  import { agentsStore } from "../services/agent-detection-service";
  import { attentionStore } from "../services/attention-api";
  import {
    branchLifecycleStore,
    listBranchDescriptors,
  } from "../services/branch-lifecycle";
  import { focusSurfaceById } from "../services/surface-service";
  import {
    TERMINAL_AGENT_STATUSES,
    agentStatusBucket,
  } from "../services/agent-status-service";
  import { workspaceRailBotStatus } from "../services/rail-attention";
  import { workspaces } from "../stores/workspace";
  import { getAllPanes } from "../types";
  import { theme } from "../stores/theme";
  import { botStatusColor, type BotStatus } from "../utils/bot-status-color";
  import BotIcon from "../icons/BotIcon.svelte";

  export let workspaceId: string;

  const activeAgents = derived(agentsStore, ($agents) =>
    $agents.filter(
      (a) =>
        a.workspaceId === workspaceId && !TERMINAL_AGENT_STATUSES.has(a.status),
    ),
  );

  // Pane ids owned by this workspace. Used by both the rail-attention
  // aggregator (so it can scope OSC attention events to this workspace)
  // and the lifecycle lookup. Reactive on `workspaces` so pane splits
  // re-flow into the status.
  const workspacePaneIds = derived(workspaces, ($ws) => {
    const w = $ws.find((x) => x.id === workspaceId);
    if (!w || !w.paneLayout) return [] as string[];
    return getAllPanes(w.paneLayout).map((p) => p.id);
  });

  const lifecycleEntry = derived(
    [agentsStore, branchLifecycleStore, workspaces],
    ([$agents, $branchLifecycle, $workspaces]) => {
      const ws = $workspaces.find((w) => w.id === workspaceId);
      // Lifecycle pill is reserved for agentically-spawned (controlled)
      // branches — manual branches stay pill-less.
      if (!ws || ws.controlled !== true) return undefined;

      const paneIds = new Set(
        $agents
          .filter((a) => a.workspaceId === workspaceId && a.paneId !== null)
          .map((a) => a.paneId as string),
      );
      if (paneIds.size === 0) return undefined;

      const matchingBranchIds = listBranchDescriptors()
        .filter((b) => b.paneId !== null && paneIds.has(b.paneId as string))
        .map((b) => b.branchId);

      if (matchingBranchIds.length !== 1) return undefined;
      return $branchLifecycle.get(matchingBranchIds[0]!);
    },
  );

  // The icon color (and the row's `data-bot-status`) come from the
  // canonical rail-attention pipeline so the inline bot icon's color
  // always agrees with the rail's bot-status bubble color — including
  // OSC-driven attention events that flip the bubble before any
  // agent's status flips to "waiting". The textual label still
  // enumerates the distinct agent-derived buckets present (waiting,
  // running, idle) so the row reports *what* the agents are doing,
  // while the color tracks the canonical "highest-priority signal"
  // the rail surfaces.
  const BUCKET_LABEL: Record<BotStatus, string> = {
    attention: "Waiting",
    thinking: "Running",
    idle: "Idle",
    none: "",
  };
  const BUCKET_ORDER: BotStatus[] = ["attention", "thinking", "idle"];

  $: fgMuted = ($theme["fgMuted"] ?? $theme.fgDim) as string;
  $: presentBuckets = (() => {
    const seen = new Set<BotStatus>();
    for (const a of $activeAgents) {
      const b = agentStatusBucket(a.status);
      if (b !== "none") seen.add(b);
    }
    return BUCKET_ORDER.filter((b) => seen.has(b));
  })();
  $: statusLabel = presentBuckets.map((b) => BUCKET_LABEL[b]).join(", ");
  $: dominantBucket = workspaceRailBotStatus(
    workspaceId,
    $workspacePaneIds,
    $agentsStore,
    $attentionStore,
  );
  $: iconColor = botStatusColor(dominantBucket) ?? fgMuted;
  $: shouldRender = statusLabel !== "" || $lifecycleEntry !== undefined;

  function handleClick() {
    const live = get(activeAgents)[0];
    if (live) focusSurfaceById(live.surfaceId);
  }
</script>

{#if shouldRender}
  <div
    class="workspace-agent-subtitle"
    data-workspace-agent-subtitle={workspaceId}
    data-agent-count={$activeAgents.length}
    data-bot-status={dominantBucket}
  >
    <button
      type="button"
      class="agent-row"
      data-agent-row={workspaceId}
      title="agents in this workspace"
      on:click|stopPropagation={handleClick}
      style="color: {fgMuted};"
    >
      <span class="icon" aria-hidden="true">
        <BotIcon size={10} color={iconColor} />
      </span>
      {#if statusLabel}
        <span class="status-text" data-status={dominantBucket}
          >{statusLabel}</span
        >
      {/if}
      {#if $lifecycleEntry}
        <span class="lifecycle-pill" data-lifecycle={$lifecycleEntry.lifecycle}>
          {$lifecycleEntry.lifecycle}
        </span>
      {/if}
    </button>
  </div>
{/if}

<style>
  .workspace-agent-subtitle {
    display: flex;
    flex-direction: column;
    /* No inner padding: the wrapping SidebarSubtitleRow already supplies
       the row-level x=2 alignment used by sibling subtitle rows. Adding
       padding here pushed the bot icon out by 6px and broke left-edge
       alignment with the inline worktree/lifecycle rows. */
    padding: 0;
    overflow: hidden;
    line-height: 1.2;
    flex: 1;
    min-width: 0;
  }

  .agent-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    width: 100%;
    background: transparent;
    border: 0;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: 10px;
    line-height: 1.2;
  }

  .agent-row:hover .status-text {
    text-decoration: underline;
  }

  .icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .status-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lifecycle-pill {
    padding: 0 5px;
    border-radius: 99px;
    font-size: 9px;
    line-height: 1.4;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: color-mix(in srgb, currentColor 15%, transparent);
    flex-shrink: 0;
  }
</style>
