<script lang="ts">
  /**
   * AgentOrchestratorRow — root-row renderer for AgentOrchestrator entities.
   *
   * The orchestrator row is a **container**: its banner is chrome (inert
   * click; context menu only), and a list of nested workspaces renders
   * beneath it. The first item in the nested list is the orchestrator's
   * Dashboard workspace (a constrained workspace with
   * `metadata.isDashboard = true`) — click the Dashboard to activate it.
   *
   * Rendering delegates to the shared `<ContainerRow>` primitive:
   *   - Banner: chrome only; context menu for rename/delete.
   *   - Close X: absent (orchestrators are deleted via the context menu,
   *     which also closes the Dashboard workspace).
   *   - Nested list: WorkspaceListView filtered to Dashboard workspace +
   *     worktrees tagged with `metadata.parentOrchestratorId === this.id`.
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
    orchestratorScopedAgents,
    getOrchestrator,
    orchestratorsStore,
    renameOrchestrator,
    deleteOrchestrator,
  } from "./orchestrator-service";
  import {
    spawnAgentInWorktree,
    type SpawnAgentType,
  } from "../../lib/services/spawn-helper";
  import { isGhAvailable } from "../../lib/services/gh-availability";
  import { slugify } from "./widget-helpers";

  /** The AgentOrchestrator's id — passed by core's WorkspaceListBlock. */
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
  const ContainerRowTyped = ContainerRow as typeof ContainerRowType;
  const PathStatusLineTyped = PathStatusLine as typeof PathStatusLineType;

  $: void $orchestratorsStore;
  $: orchestrator = getOrchestrator(id);

  // Nested list = the Dashboard workspace (always first) + any worktree
  // workspaces spawned from this orchestrator. WorkspaceListView sorts
  // Dashboard workspaces ahead of others and renders them as a distinct
  // tile (no grip, no X, full-color background).
  $: nestedWorkspaceIds = new Set(
    $workspacesStore
      .filter((ws) => {
        const meta = ws.metadata as Record<string, unknown> | undefined;
        if (!meta) return false;
        return meta.parentOrchestratorId === id || meta.orchestratorId === id;
      })
      .map((ws) => ws.id),
  );

  function contrastColor(hex: string): string {
    const clean = hex.replace(/^#/, "");
    if (clean.length !== 6) return "#fff";
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? "#000" : "#fff";
  }

  $: orchestratorHex = orchestrator
    ? resolveProjectColor(orchestrator.color, $theme)
    : $theme.accent;
  $: bannerFg = contrastColor(orchestratorHex);
  $: subtitleFg =
    bannerFg === "#000" ? "rgba(0, 0, 0, 0.7)" : "rgba(255, 255, 255, 0.8)";

  // Aggregated orchestrator status for the banner dot (detected-agent rollup).
  const agentsStore = api.agents;
  $: scoped = orchestrator
    ? orchestratorScopedAgents(orchestrator, $agentsStore)
    : [];
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
    if (!orchestrator) return;
    const next = await api.showInputPrompt(
      "Rename orchestrator",
      orchestrator.name,
    );
    const trimmed = next?.trim();
    if (!trimmed || trimmed === orchestrator.name) return;
    await renameOrchestrator(orchestrator.id, trimmed);
  }

  async function handleDelete() {
    if (!orchestrator) return;
    const confirmed = await api.showConfirm(
      `Delete orchestrator "${orchestrator.name}"? Its Dashboard workspace will be closed; spawned worktrees are not affected.`,
      {
        title: "Delete Orchestrator",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
    if (!confirmed) return;
    await deleteOrchestrator(orchestrator.id);
  }

  function handleContextMenu(e: MouseEvent) {
    if (!orchestrator) return;
    e.preventDefault();
    e.stopPropagation();
    api.showContextMenu(e.clientX, e.clientY, [
      {
        label: "Rename Orchestrator",
        action: () => {
          void handleRename();
        },
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "Delete Orchestrator",
        danger: true,
        action: () => {
          void handleDelete();
        },
      },
    ]);
  }

  // --- "+ New" split-button handlers ---

  const AGENT_CHOICES = [
    { label: "Claude Code", value: "claude-code" },
    { label: "Codex", value: "codex" },
    { label: "Aider", value: "aider" },
    { label: "Custom", value: "custom" },
  ];

  async function handleNewTask() {
    if (!orchestrator) return;
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
        repoPath: orchestrator.baseDir,
        branch,
        orchestratorId: orchestrator.id,
        ...(orchestrator.parentGroupId
          ? { groupId: orchestrator.parentGroupId }
          : {}),
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
    if (!orchestrator) return;
    if (!(await isGhAvailable())) {
      api.reportError(
        "GitHub CLI not available — install `gh` and run `gh auth login` to resolve issues.",
      );
      return;
    }
    let issues: GhIssueSummary[] = [];
    try {
      const raw = await api.invoke<GhIssueSummary[]>("gh_list_issues", {
        repoPath: orchestrator.baseDir,
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
        repoPath: orchestrator.baseDir,
        branch: `agent/${agent}/${issue.number}-${branchSlug}`,
        orchestratorId: orchestrator.id,
        ...(orchestrator.parentGroupId
          ? { groupId: orchestrator.parentGroupId }
          : {}),
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

  function isIconName(value: string): boolean {
    return /^[a-z][a-z0-9-]*:[a-z0-9-]+$/i.test(value);
  }

  $: iconValue = $theme.dashboardIcon ?? "lucide:layout-dashboard";
  $: showIconAsName = isIconName(iconValue);
</script>

{#if orchestrator}
  <div data-orchestrator-row-wrapper={orchestrator.id}>
    <svelte:component
      this={ContainerRowTyped}
      color={orchestratorHex}
      foreground={bannerFg}
      {parentColor}
      onGripMouseDown={parentColor ? undefined : onGripMouseDown}
      gripAriaLabel="Drag orchestrator to reorder"
      onBannerContextMenu={handleContextMenu}
      onClose={() => void handleDelete()}
      closeTitle="Delete orchestrator"
      filterIds={nestedWorkspaceIds}
      scopeId={orchestrator.id}
      containerBlockId="__workspaces__"
      containerLabel={orchestrator.name}
      testId={orchestrator.id}
      workspaceListViewComponent={WorkspaceListView ?? undefined}
    >
      <span
        slot="icon"
        aria-hidden="true"
        data-orchestrator-icon
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
            <title>Orchestrator</title>
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
        data-orchestrator-id={orchestrator.id}
        style="
          flex: 1; min-width: 0;
          font-size: 13px; font-weight: 600; color: {bannerFg};
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        ">{orchestrator.name}</span
      >

      <svelte:fragment slot="banner-end">
        {#if dotColor}
          <span
            title={dotStatus ?? ""}
            data-orchestrator-banner-status-dot={dotStatus}
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
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="orchestrator-new-chip"
            on:click|stopPropagation
            style="
              flex-shrink: 0; border-radius: 6px; overflow: visible;
              background: {bannerFg === '#000'
              ? 'rgba(0, 0, 0, 0.12)'
              : 'rgba(0, 0, 0, 0.22)'};
              --orchestrator-btn-fg: {bannerFg};
              --orchestrator-btn-hover-bg: {bannerFg === '#000'
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
        <div style="pointer-events: auto;">
          <svelte:component
            this={PathStatusLineTyped}
            target={{
              id: orchestrator.id,
              path: orchestrator.baseDir,
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
  :global(.orchestrator-new-chip button) {
    border-color: transparent !important;
    color: var(--orchestrator-btn-fg) !important;
  }
  :global(.orchestrator-new-chip button:hover) {
    background: var(--orchestrator-btn-hover-bg) !important;
  }
</style>
