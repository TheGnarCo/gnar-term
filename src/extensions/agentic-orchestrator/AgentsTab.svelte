<script lang="ts">
  import { onMount, onDestroy, getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import {
    getAgents,
    getSessionLog,
    type DetectedAgent,
    type SessionLogEntry,
  } from "./agent-registry";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  const STATUS_COLORS: Record<string, string> = {
    running: "#4ec957",
    active: "#4ec957",
    waiting: "#e8b73a",
    idle: "#888888",
  };

  let instances: DetectedAgent[] = [];
  let sessionLog: SessionLogEntry[] = [];
  let logCollapsed = true;

  function refresh() {
    instances = getAgents();
    sessionLog = getSessionLog();
  }

  $: waitingInstances = instances.filter((i) => i.status === "waiting");
  $: activeInstances = instances.filter((i) => i.status !== "waiting");

  function statusColor(status: string): string {
    return STATUS_COLORS[status] ?? STATUS_COLORS.idle ?? "#888888";
  }

  function formatAge(isoDate: string): string {
    try {
      const ms = Date.now() - new Date(isoDate).getTime();
      const secs = Math.floor(ms / 1000);
      if (secs < 60) return `${secs}s`;
      const mins = Math.floor(secs / 60);
      if (mins < 60) return `${mins}m`;
      const hrs = Math.floor(mins / 60);
      return `${hrs}h`;
    } catch {
      return "";
    }
  }

  function handleClick(instance: DetectedAgent) {
    api.focusSurface(instance.surfaceId);
  }

  // Register refresh callback for the sidebar action
  api.state.set("agents-refresh", refresh);

  // Listen for status changes to update the list
  const handleStatusChange = () => refresh();
  api.on("extension:harness:statusChanged", handleStatusChange);
  api.on("surface:created", handleStatusChange);
  api.on("surface:closed", handleStatusChange);

  const cleanup = () => {
    api.off("extension:harness:statusChanged", handleStatusChange);
    api.off("surface:created", handleStatusChange);
    api.off("surface:closed", handleStatusChange);
  };

  let ageTimer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    refresh();
    // Update elapsed time display every 2 seconds
    ageTimer = setInterval(() => {
      instances = instances;
    }, 2000);
  });

  onDestroy(() => {
    cleanup();
    if (ageTimer) clearInterval(ageTimer);
  });
</script>

<div
  class="agents-tab"
  style="flex: 1; overflow-y: auto; padding: 4px 0; font-size: 12px;"
>
  {#if instances.length === 0 && sessionLog.length === 0}
    <div style="color: {$theme.fgDim}; padding: 12px; font-style: italic;">
      No detected agents
    </div>
  {:else}
    <!-- Waiting section (always visible when there are waiting agents) -->
    {#if waitingInstances.length > 0}
      <div
        style="
          padding: 6px 12px; font-size: 11px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.5px;
          color: {STATUS_COLORS.waiting}; border-bottom: 1px solid {$theme.border};
        "
      >
        Waiting ({waitingInstances.length})
      </div>
      {#each waitingInstances as instance (instance.agentId)}
        <button
          class="list-item"
          style="
            width: 100%; background: rgba(232, 183, 58, 0.08); border: none;
            padding: 6px 12px; color: {$theme.fg}; cursor: pointer;
            display: flex; align-items: center; gap: 8px;
            font-size: 12px; text-align: left;
          "
          on:click={() => handleClick(instance)}
        >
          <span
            style="
              width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
              background: {STATUS_COLORS.waiting};
            "
          ></span>
          <div
            style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px;"
          >
            <span
              style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;"
            >
              {instance.agentName}
            </span>
          </div>
        </button>
      {/each}
    {/if}

    <!-- Active section -->
    {#if activeInstances.length > 0}
      <div
        style="
          padding: 6px 12px; font-size: 11px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.5px;
          color: {$theme.fg}; border-bottom: 1px solid {$theme.border};
        "
      >
        Active ({activeInstances.length})
      </div>
      {#each activeInstances as instance (instance.agentId)}
        <button
          class="list-item"
          style="
            width: 100%; background: none; border: none;
            padding: 6px 12px; color: {$theme.fg}; cursor: pointer;
            display: flex; align-items: center; gap: 8px;
            font-size: 12px; text-align: left;
          "
          on:click={() => handleClick(instance)}
        >
          <span
            style="
              width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
              background: {statusColor(instance.status)};
            "
          ></span>
          <div
            style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px;"
          >
            <div
              style="display: flex; align-items: baseline; gap: 6px; overflow: hidden;"
            >
              <span
                style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;"
              >
                {instance.agentName}
              </span>
              <span
                style="color: {statusColor(
                  instance.status,
                )}; font-size: 10px; flex-shrink: 0;"
              >
                {instance.status}
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span
                style="color: {$theme.fgDim}; font-size: 10px; flex-shrink: 0;"
              >
                {formatAge(instance.createdAt)}
              </span>
            </div>
          </div>
        </button>
      {/each}
    {/if}

    <!-- Session Log section -->
    {#if sessionLog.length > 0}
      <button
        class="section-header"
        style="
          width: 100%; background: none; border: none; border-bottom: 1px solid {$theme.border};
          padding: 6px 12px; color: {$theme.fgDim}; cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.5px; text-align: left;
        "
        on:click={() => (logCollapsed = !logCollapsed)}
      >
        <span
          style="display: inline-block; transition: transform 0.15s; transform: rotate({logCollapsed
            ? '0deg'
            : '90deg'}); font-size: 10px; width: 12px;">{"\u203A"}</span
        >
        Session Log
        <span style="font-weight: 400; margin-left: auto;"
          >{sessionLog.length}</span
        >
      </button>

      {#if !logCollapsed}
        {#each sessionLog as entry (entry.agentId + entry.closedAt)}
          <div
            class="list-item"
            style="
              padding: 4px 12px 4px 28px; color: {$theme.fgDim};
              display: flex; flex-direction: column; gap: 1px;
              font-size: 12px;
            "
          >
            <div
              style="display: flex; align-items: baseline; gap: 6px; overflow: hidden;"
            >
              <span
                style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
              >
                {entry.agentName}
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 10px;">
                closed {formatAge(entry.closedAt)}
              </span>
            </div>
          </div>
        {/each}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .list-item:hover {
    background: rgba(255, 255, 255, 0.05) !important;
  }
  .section-header:hover {
    background: rgba(255, 255, 255, 0.03) !important;
  }
</style>
