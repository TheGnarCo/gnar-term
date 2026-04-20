<script lang="ts">
  /**
   * AgentDashboardRow — root-row renderer for AgentDashboard entities.
   *
   * The agent-dashboard row is a **container workspace**: its banner
   * represents the hosting workspace itself (the one tagged with
   * metadata.dashboardId), and worktree workspaces spawned from the
   * dashboard nest underneath. Compare to project rows, whose banner is
   * pure chrome (no workspace of its own).
   *
   * Rendering delegates to the shared `<ContainerRow>` primitive:
   *   - Banner click → openDashboard (switches to hosting workspace +
   *     ensures the dashboard preview surface exists).
   *   - Close X → closes the hosting workspace.
   *   - Nested list → WorkspaceListView filtered by
   *     metadata.parentDashboardId === this dashboard's id. Hosting
   *     workspace is NOT in the nested list — the banner represents it.
   *   - Visual modes: root (grip + banner + nested) vs. project-nested
   *     (banner only, right-edge accent) are handled by ContainerRow
   *     via the `parentColor` prop.
   */
  import { getContext, type Component } from "svelte";
  import type ContainerRowType from "../../lib/components/ContainerRow.svelte";
  import type PathStatusLineType from "../../lib/components/PathStatusLine.svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    resolveProjectColor,
  } from "../api";
  import {
    openDashboard,
    dashboardScopedAgents,
    getDashboard,
    dashboardsStore,
    renameDashboard,
    deleteDashboard,
  } from "./dashboard-service";
  import {
    spawnAgentInWorktree,
    type SpawnAgentType,
  } from "../../lib/services/spawn-helper";
  import { isGhAvailable } from "../../lib/services/gh-availability";
  import { slugify } from "./widget-helpers";

  /** The AgentDashboard's id — passed by core's WorkspaceListBlock. */
  export let id: string;
  /** Drag handle forwarded to ContainerRow's grip. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /** When non-null, this row is nested inside a parent container. */
  export let parentColor: string | undefined = undefined;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const workspacesStore = api.workspaces;
  const { ContainerRow, WorkspaceListView, SplitButton, PathStatusLine } =
    api.getComponents();
  // Type-only import binds slot defs so <svelte:component> can type-check
  // the slot contents this file provides.
  const ContainerRowTyped = ContainerRow as typeof ContainerRowType;
  const PathStatusLineTyped = PathStatusLine as typeof PathStatusLineType;

  $: void $dashboardsStore;
  $: dashboard = getDashboard(id);

  // Nested list = worktree workspaces spawned from this dashboard. The
  // hosting workspace (metadata.dashboardId === id) is represented by the
  // banner itself — never re-rendered as a nested row.
  $: nestedWorkspaceIds = new Set(
    $workspacesStore
      .filter(
        (ws) =>
          (ws.metadata as Record<string, unknown> | undefined)
            ?.parentDashboardId === id,
      )
      .map((ws) => ws.id),
  );

  // Pick a foreground that remains legible on an arbitrary dashboard color.
  function contrastColor(hex: string): string {
    const clean = hex.replace(/^#/, "");
    if (clean.length !== 6) return "#fff";
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? "#000" : "#fff";
  }

  $: dashboardHex = dashboard
    ? resolveProjectColor(dashboard.color, $theme)
    : $theme.accent;
  $: bannerFg = contrastColor(dashboardHex);
  $: subtitleFg =
    bannerFg === "#000" ? "rgba(0, 0, 0, 0.7)" : "rgba(255, 255, 255, 0.8)";

  // Aggregated dashboard status for the banner dot (detected-agent rollup).
  const agentsStore = api.agents;
  $: scoped = dashboard ? dashboardScopedAgents(dashboard, $agentsStore) : [];
  $: runningCount = scoped.filter((a) => a.status === "running").length;
  $: waitingCount = scoped.filter((a) => a.status === "waiting").length;
  $: dotStatus =
    waitingCount > 0
      ? "waiting"
      : runningCount > 0
        ? "running"
        : scoped.length > 0
          ? "idle"
          : null;
  $: dotColor =
    dotStatus === "running"
      ? "#4ec957"
      : dotStatus === "waiting"
        ? "#e8b73a"
        : dotStatus === "idle"
          ? "#888888"
          : null;
  async function handleRename() {
    if (!dashboard) return;
    const next = await api.showInputPrompt("Rename dashboard", dashboard.name);
    const trimmed = next?.trim();
    if (!trimmed || trimmed === dashboard.name) return;
    await renameDashboard(dashboard.id, trimmed);
  }

  async function handleDelete() {
    if (!dashboard) return;
    await deleteDashboard(dashboard.id);
  }

  function handleContextMenu(e: MouseEvent) {
    if (!dashboard) return;
    e.preventDefault();
    e.stopPropagation();
    api.showContextMenu(e.clientX, e.clientY, [
      {
        label: "Rename Dashboard",
        action: () => {
          void handleRename();
        },
      },
      {
        label: "Open Dashboard",
        action: () => {
          if (dashboard) openDashboard(dashboard);
        },
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "Delete Dashboard",
        danger: true,
        action: () => {
          void handleDelete();
        },
      },
    ]);
  }

  function handleBannerClick() {
    if (dashboard) openDashboard(dashboard);
  }

  // --- "+ New" split-button handlers ---
  //
  // Primary: New Task — prompts for a description + agent, spawns a
  // worktree workspace tagged to this dashboard.
  // Dropdown: Resolve Issue — fetches open GH issues scoped to the
  // dashboard's baseDir, user picks one, spawns an agent with the
  // issue context and URL as the startup task.

  const AGENT_CHOICES = [
    { label: "Claude Code", value: "claude-code" },
    { label: "Codex", value: "codex" },
    { label: "Aider", value: "aider" },
    { label: "Custom", value: "custom" },
  ];

  async function handleNewTask() {
    if (!dashboard) return;
    const result = await api.showFormPrompt("New Task", [
      {
        key: "task",
        label: "Task description",
        placeholder: "What should the agent do?",
        defaultValue: "",
      },
      {
        key: "agent",
        label: "Agent",
        type: "select",
        options: AGENT_CHOICES,
        defaultValue: "claude-code",
      },
      {
        key: "branch",
        label: "Branch (optional — auto if blank)",
        defaultValue: "",
        placeholder: "agent/claude-code/<slug>",
      },
    ]);
    if (!result) return;
    const task = (result.task ?? "").trim();
    if (!task) return;
    const agent = (result.agent ?? "claude-code") as SpawnAgentType;
    const branchOverride = (result.branch ?? "").trim();
    const branch = branchOverride
      ? branchOverride
      : `agent/${agent}/${slugify(task).slice(0, 40)}`;
    try {
      await spawnAgentInWorktree({
        name: `${agent}: ${task.slice(0, 60)}`,
        agent,
        ...(agent === "custom" ? { command: agent } : {}),
        taskContext: task,
        repoPath: dashboard.baseDir,
        branch,
        dashboardId: dashboard.id,
      });
    } catch (err) {
      api.reportError(
        `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  interface GhIssueSummary {
    number: number;
    title: string;
    url: string;
  }

  async function handleResolveIssue() {
    if (!dashboard) return;
    if (!(await isGhAvailable())) {
      api.reportError(
        "GitHub CLI not available — install `gh` and run `gh auth login` to resolve issues.",
      );
      return;
    }
    let issues: GhIssueSummary[] = [];
    try {
      const raw = await api.invoke<GhIssueSummary[]>("gh_list_issues", {
        repoPath: dashboard.baseDir,
        state: "open",
      });
      issues = Array.isArray(raw) ? raw : [];
    } catch (err) {
      api.reportError(
        `Failed to load issues: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (issues.length === 0) {
      api.reportError("No open issues found in this repo.");
      return;
    }
    const issueOptions = issues.map((i) => ({
      label: `#${i.number} ${i.title}`,
      value: String(i.number),
    }));
    const result = await api.showFormPrompt("Resolve Issue", [
      {
        key: "issueNumber",
        label: "Issue",
        type: "select",
        options: issueOptions,
        defaultValue: issueOptions[0]?.value ?? "",
      },
      {
        key: "agent",
        label: "Agent",
        type: "select",
        options: AGENT_CHOICES,
        defaultValue: "claude-code",
      },
    ]);
    if (!result) return;
    const num = Number(result.issueNumber);
    const issue = issues.find((i) => i.number === num);
    if (!issue) return;
    const agent = (result.agent ?? "claude-code") as SpawnAgentType;
    const branchSlug = slugify(issue.title).slice(0, 30) || "task";
    try {
      await spawnAgentInWorktree({
        name: `${agent}: #${issue.number} ${issue.title}`,
        agent,
        ...(agent === "custom" ? { command: agent } : {}),
        taskContext: `Issue #${issue.number}: ${issue.title}\n${issue.url}`,
        repoPath: dashboard.baseDir,
        branch: `agent/${agent}/${issue.number}-${branchSlug}`,
        dashboardId: dashboard.id,
      });
    } catch (err) {
      api.reportError(
        `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  $: splitDropdownItems = [
    {
      id: "new-task",
      label: "New Task",
      icon: "plus",
      handler: () => void handleNewTask(),
    },
    {
      id: "resolve-issue",
      label: "Resolve Issue...",
      icon: "git-branch",
      handler: () => void handleResolveIssue(),
    },
  ];

  // Close X on the dashboard container row — destructive, removes the
  // dashboard entity entirely (delete). Confirms first. The hosting
  // workspace and any spawned worktrees are left alone — users manage
  // their own workspace lifecycle; the X scoped to the container deletes
  // just the dashboard record. Per user direction: "Projects delete
  // project; Agent-dashboards delete dashboard."
  async function handleClose() {
    if (!dashboard) return;
    const confirmed = await api.showConfirm(
      `Delete dashboard "${dashboard.name}"? This removes the dashboard record; open workspaces are not affected.`,
      {
        title: "Delete Dashboard",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
    if (!confirmed) return;
    await deleteDashboard(dashboard.id);
  }

  function isIconName(value: string): boolean {
    return /^[a-z][a-z0-9-]*:[a-z0-9-]+$/i.test(value);
  }

  $: iconValue = $theme.dashboardIcon ?? "lucide:layout-dashboard";
  $: showIconAsName = isIconName(iconValue);
</script>

{#if dashboard}
  <div data-dashboard-row-wrapper={dashboard.id}>
    <svelte:component
      this={ContainerRowTyped}
      color={dashboardHex}
      foreground={bannerFg}
      {parentColor}
      onGripMouseDown={parentColor ? undefined : onGripMouseDown}
      gripAriaLabel="Drag dashboard to reorder"
      onBannerClick={handleBannerClick}
      onBannerContextMenu={handleContextMenu}
      onClose={handleClose}
      closeTitle="Delete dashboard"
      filterIds={nestedWorkspaceIds}
      scopeId={dashboard.id}
      containerBlockId="__workspaces__"
      containerLabel={dashboard.name}
      testId={dashboard.id}
      workspaceListViewComponent={WorkspaceListView ?? undefined}
    >
      <span
        slot="icon"
        aria-hidden="true"
        data-dashboard-icon
        style="
          flex-shrink: 0; display: inline-flex; align-items: center;
          justify-content: center; width: 14px; height: 14px;
          color: {bannerFg};
        "
      >
        {#if showIconAsName}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <title>Dashboard</title>
            <rect x="3" y="3" width="7" height="9" />
            <rect x="14" y="3" width="7" height="5" />
            <rect x="14" y="12" width="7" height="9" />
            <rect x="3" y="16" width="7" height="5" />
          </svg>
        {:else}
          <span style="font-size: 13px; line-height: 1;">{iconValue}</span>
        {/if}
      </span>

      <span
        data-dashboard-id={dashboard.id}
        style="
          flex: 1; min-width: 0;
          font-size: 13px; font-weight: 600; color: {bannerFg};
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        ">{dashboard.name}</span
      >

      <svelte:fragment slot="banner-end">
        {#if dotColor}
          <span
            title={dotStatus ?? ""}
            data-dashboard-banner-status-dot={dotStatus}
            style="
              display: inline-flex; align-items: center; gap: 3px;
              font-size: 10px; color: {bannerFg};
              background: color-mix(in srgb, {bannerFg} 18%, transparent);
              padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
            "
          >
            <span
              style="width: 6px; height: 6px; border-radius: 50%; background: {dotColor};"
            ></span>
            {#if scoped.length > 1}{scoped.length}
            {/if}{dotStatus}
          </span>
        {/if}
        {#if SplitButton}
          <!-- "+ New" chip — offers New Task (primary) and Resolve
               Issue (dropdown). Mirrors the project banner chip so both
               container rows have a consistent spawn affordance.
               stopPropagation prevents the banner-wide click handler
               from firing when the user interacts with the chip. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="dashboard-new-chip"
            on:click|stopPropagation
            style="
              flex-shrink: 0; border-radius: 6px; overflow: visible;
              background: {bannerFg === '#000'
              ? 'rgba(0, 0, 0, 0.12)'
              : 'rgba(0, 0, 0, 0.22)'};
              --dashboard-btn-fg: {bannerFg};
              --dashboard-btn-hover-bg: {bannerFg === '#000'
              ? 'rgba(0, 0, 0, 0.22)'
              : 'rgba(0, 0, 0, 0.36)'};
            "
          >
            <svelte:component
              this={SplitButton as Component}
              label="+ New"
              onMainClick={() => void handleNewTask()}
              dropdownItems={splitDropdownItems}
              {theme}
            />
          </span>
        {/if}
      </svelte:fragment>

      <svelte:fragment slot="banner-subtitle">
        <!-- Same status rendering as project rows: path + branch + open
             PRs + dirty count. Scoped to the dashboard's baseDir so it
             shows the state of the repo the dashboard covers. Assumes
             baseDir is a git repo (dashboards are typically created
             against project roots). -->
        <div style="pointer-events: auto;">
          <svelte:component
            this={PathStatusLineTyped}
            target={{
              id: dashboard.id,
              path: dashboard.baseDir,
              isGit: true,
            }}
            fgColor={subtitleFg}
          />
        </div>
      </svelte:fragment>
    </svelte:component>
  </div>
{/if}

<style>
  /* SplitButton inside the banner-embedded "+ New" chip — mirrors
     project-scope's project-new-chip styling so the chip reads as a
     tonal wash on any dashboard color, not a bordered grey button. */
  :global(.dashboard-new-chip button) {
    border-color: transparent !important;
    color: var(--dashboard-btn-fg) !important;
  }
  :global(.dashboard-new-chip button:hover) {
    background: var(--dashboard-btn-hover-bg) !important;
  }
</style>
