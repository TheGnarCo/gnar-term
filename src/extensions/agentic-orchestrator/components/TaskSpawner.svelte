<script lang="ts">
  /**
   * TaskSpawner — manual "+ New Task" affordance inside a dashboard.
   *
   * The spawn target is derived from the enclosing DashboardHostContext:
   *   - "workspace" scope → repoPath = the workspace's path;
   *     metadata.parentWorkspaceId + metadata.spawnedBy = { kind:'workspace', parentWorkspaceId }
   *   - "global" scope → repoPath from the `repoPath` config prop (the
   *     Global Agentic Dashboard can't infer a repo on its own);
   *     metadata.spawnedBy = { kind:'global' }
   *   - "none" → form is disabled, "No scope" error shown
   *
   * The form's task description becomes the agent's startup task context
   * (passed as a single quoted argument).
   *
   * Config:
   *   repoPath?: string — required for global scope; ignored for workspace
   *   defaultAgent?: string — picker default (defaults to claude-code)
   */
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import {
    resolveSpawnTarget,
    scopeAttrs,
    slugify,
    SPAWN_AGENT_OPTIONS,
  } from "../widget-helpers";
  import {
    spawnAgentInWorktree,
    type SpawnAgentType,
  } from "../../../lib/services/spawn-helper";
  import {
    deriveDashboardScope,
    getDashboardHost,
  } from "../../../lib/contexts/dashboard-host";

  /** Required when the enclosing host is global (no workspace.path to infer). */
  export let repoPath: string | undefined = undefined;
  export let defaultAgent: string = "claude-code";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);

  let expanded = false;
  let task = "";
  let agent: SpawnAgentType = defaultAgent as SpawnAgentType;
  let branch = "";
  let dropdownOpen = false;
  let spawning = false;
  let spawnError = "";

  $: target = resolveSpawnTarget(scope, repoPath);
  $: hasTarget = target.ok;
  $: branchPlaceholder = task ? slugify(task) : "task-branch";
  $: canSpawn = task.trim().length > 0 && hasTarget && !spawning;

  function expand() {
    expanded = true;
  }

  function cancel() {
    expanded = false;
    task = "";
    branch = "";
    agent = defaultAgent as SpawnAgentType;
    dropdownOpen = false;
    spawnError = "";
  }

  async function spawn() {
    if (!canSpawn) return;
    if (!target.ok) {
      spawnError = target.error;
      return;
    }
    spawning = true;
    spawnError = "";
    try {
      const trimmedTask = task.trim();
      const trimmedBranch = branch.trim();
      const branchName = trimmedBranch
        ? trimmedBranch
        : `agent/${agent}/${slugify(trimmedTask).slice(0, 40)}`;
      await spawnAgentInWorktree({
        name: `${agent}: ${trimmedTask.slice(0, 60)}`,
        agent,
        ...(agent === "custom" ? { command: agent } : {}),
        taskContext: trimmedTask,
        repoPath: target.repoPath,
        branch: branchName,
        spawnedBy: target.spawnedBy,
        ...(target.parentWorkspaceId
          ? { parentWorkspaceId: target.parentWorkspaceId }
          : {}),
      });
      // Success — collapse the form back to the "+ New Task" button.
      cancel();
    } catch (err) {
      spawnError = `Spawn failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      spawning = false;
    }
  }

  function selectAgent(id: SpawnAgentType) {
    agent = id;
    dropdownOpen = false;
  }

  $: agentLabel =
    SPAWN_AGENT_OPTIONS.find((o) => o.id === agent)?.label ?? agent;
</script>

<div
  data-task-spawner
  {...scopeAttrs(scope)}
  style="
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px; border: 1px solid {$theme.border};
    border-radius: 6px; background: {$theme.bgSurface};
  "
>
  {#if !expanded}
    <button
      data-task-spawner-expand
      on:click={expand}
      style="
        background: transparent; color: {$theme.fg};
        border: 1px dashed {$theme.border}; border-radius: 4px;
        padding: 8px 12px; font-size: 12px; cursor: pointer; text-align: left;
      "
    >
      + New Task
    </button>
  {:else}
    <div
      data-task-spawner-form
      style="display: flex; flex-direction: column; gap: 8px;"
    >
      <textarea
        data-task-spawner-task
        bind:value={task}
        placeholder="What should the agent do?"
        aria-label="Task description"
        rows="3"
        style="
          width: 100%; box-sizing: border-box;
          background: {$theme.bg}; color: {$theme.fg};
          border: 1px solid {$theme.border}; border-radius: 4px;
          padding: 8px; font-size: 12px; font-family: inherit; resize: vertical;
        "
      ></textarea>

      <div
        data-task-spawner-row
        style="display: flex; align-items: center; gap: 8px;"
      >
        <!-- Agent split-button picker -->
        <div
          data-task-spawner-agent-picker
          style="position: relative; display: inline-flex; align-items: stretch;"
        >
          <button
            data-task-spawner-agent
            type="button"
            on:click={() => (dropdownOpen = !dropdownOpen)}
            aria-label="Current agent: {agentLabel}. Activate to choose a different agent."
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            style="
              background: transparent; color: {$theme.fg};
              border: 1px solid {$theme.border}; border-right: none;
              border-radius: 4px 0 0 4px;
              padding: 4px 8px; font-size: 11px; cursor: pointer;
            "
          >
            {agentLabel}
          </button>
          <button
            data-task-spawner-agent-caret
            on:click={() => (dropdownOpen = !dropdownOpen)}
            aria-label="Choose agent"
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            title="Choose agent"
            style="
              background: {dropdownOpen ? $theme.bgHighlight : 'transparent'};
              color: {$theme.fgDim};
              border: 1px solid {$theme.border}; border-radius: 0 4px 4px 0;
              padding: 4px 6px; font-size: 11px; cursor: pointer;
            "
          >
            ▾
          </button>
          {#if dropdownOpen}
            <div
              role="menu"
              data-task-spawner-agent-dropdown
              style="
                position: absolute; top: 100%; left: 0; margin-top: 2px;
                background: {$theme.bgFloat ?? $theme.bgSurface};
                border: 1px solid {$theme.border}; border-radius: 4px;
                padding: 4px; min-width: 140px; z-index: 9999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
              "
            >
              {#each SPAWN_AGENT_OPTIONS as opt (opt.id)}
                <div
                  role="menuitem"
                  tabindex="-1"
                  data-task-spawner-agent-option={opt.id}
                  on:click={() => selectAgent(opt.id)}
                  on:keydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectAgent(opt.id);
                    }
                  }}
                  style="
                    padding: 4px 8px; cursor: pointer; font-size: 12px;
                    color: {$theme.fg}; border-radius: 3px;
                  "
                  on:mouseenter={(e) => {
                    const el = e.currentTarget;
                    if (el instanceof HTMLElement)
                      el.style.background = $theme.bgHighlight;
                  }}
                  on:mouseleave={(e) => {
                    const el = e.currentTarget;
                    if (el instanceof HTMLElement)
                      el.style.background = "transparent";
                  }}
                >
                  {opt.label}
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <input
          data-task-spawner-branch
          type="text"
          bind:value={branch}
          placeholder={branchPlaceholder}
          aria-label="Branch name"
          style="
            flex: 1; min-width: 0;
            background: {$theme.bg}; color: {$theme.fg};
            border: 1px solid {$theme.border}; border-radius: 4px;
            padding: 4px 8px; font-size: 11px; font-family: monospace;
          "
        />
      </div>

      <div
        data-task-spawner-actions
        style="display: flex; gap: 8px; justify-content: flex-end;"
      >
        <button
          data-task-spawner-cancel
          on:click={cancel}
          style="
            background: transparent; color: {$theme.fgDim};
            border: 1px solid {$theme.border}; border-radius: 4px;
            padding: 4px 12px; font-size: 11px; cursor: pointer;
          "
        >
          Cancel
        </button>
        <button
          data-task-spawner-spawn
          on:click={spawn}
          disabled={!canSpawn}
          style="
            background: {canSpawn ? $theme.accent : 'transparent'};
            color: {canSpawn ? $theme.bg : $theme.fgDim};
            border: 1px solid {canSpawn ? $theme.accent : $theme.border};
            border-radius: 4px;
            padding: 4px 12px; font-size: 11px;
            cursor: {canSpawn ? 'pointer' : 'not-allowed'};
            opacity: {canSpawn ? 1 : 0.5};
          "
        >
          {spawning ? "Spawning..." : "Spawn"}
        </button>
      </div>
      {#if spawnError}
        <div
          data-task-spawner-error
          style="color: {$theme.danger}; font-size: 11px;"
        >
          {spawnError}
        </div>
      {/if}
    </div>
  {/if}
</div>
