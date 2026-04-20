<script lang="ts">
  /**
   * TaskSpawner — manual "+ New Task" affordance for an orchestrator.
   *
   * Spawns the chosen agent into a fresh worktree workspace tagged
   * with this orchestrator. The form's task description becomes the
   * agent's startup task context (passed as a single quoted argument).
   *
   * Config:
   *   orchestratorId: string         — required; scopes the spawn target
   *   defaultAgent?: string       — picker default (defaults to claude-code)
   */
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import { getOrchestrator } from "../orchestrator-service";
  import { slugify } from "../widget-helpers";
  import {
    spawnAgentInWorktree,
    type SpawnAgentType,
  } from "../../../lib/services/spawn-helper";

  export let orchestratorId: string;
  export let defaultAgent: string = "claude-code";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  let expanded = false;
  let task = "";
  let agent: SpawnAgentType = defaultAgent as SpawnAgentType;
  let branch = "";
  let dropdownOpen = false;
  let spawning = false;
  let spawnError = "";

  const AGENT_OPTIONS: Array<{ id: SpawnAgentType; label: string }> = [
    { id: "claude-code", label: "Claude Code" },
    { id: "codex", label: "Codex" },
    { id: "aider", label: "Aider" },
    { id: "custom", label: "Custom..." },
  ];

  $: orchestrator = getOrchestrator(orchestratorId);
  $: branchPlaceholder = task ? slugify(task) : "task-branch";
  $: canSpawn = task.trim().length > 0 && !!orchestrator && !spawning;

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
    if (!orchestrator) {
      spawnError = "Orchestrator not found";
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
        repoPath: orchestrator.baseDir,
        branch: branchName,
        orchestratorId,
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

  $: agentLabel = AGENT_OPTIONS.find((o) => o.id === agent)?.label ?? agent;
</script>

<div
  data-task-spawner
  data-orchestrator-id={orchestratorId}
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
              data-task-spawner-agent-dropdown
              style="
                position: absolute; top: 100%; left: 0; margin-top: 2px;
                background: {$theme.bgFloat ?? $theme.bgSurface};
                border: 1px solid {$theme.border}; border-radius: 4px;
                padding: 4px; min-width: 140px; z-index: 9999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
              "
            >
              {#each AGENT_OPTIONS as opt (opt.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  data-task-spawner-agent-option={opt.id}
                  on:click={() => selectAgent(opt.id)}
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
