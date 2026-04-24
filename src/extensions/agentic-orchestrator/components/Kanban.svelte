<script lang="ts">
  /**
   * Kanban — four-column status grid: Running / Waiting / Idle / Done.
   * Each column lists scoped agents as cards derived from the enclosing
   * `DashboardHostContext`. Click a card → jump to the owning surface.
   * Scope follows widget-helpers' rules (global, group, or none).
   */
  import { getContext } from "svelte";
  import {
    EXTENSION_API_KEY,
    type AgentRef,
    type ExtensionAPI,
  } from "../../api";
  import {
    bucketForStatus,
    hostScopedAgentsStore,
    jumpToAgent,
    scopeAttrs,
    statusColor,
    timeAgo,
    workspaceNameFor,
    type KanbanColumn,
  } from "../widget-helpers";
  import {
    deriveDashboardScope,
    getDashboardHost,
  } from "../../../lib/contexts/dashboard-host";

  /**
   * Optional title shown above the column grid. Empty by default — the
   * dashboard's top-level markdown heading is the authoritative title,
   * so most callers want no inline header here.
   */
  export let title: string = "";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);
  const agents = hostScopedAgentsStore(api, host);

  // Bucket agents into the four columns. Re-derived on every store change.
  const COLUMN_DEFS: Array<{ id: KanbanColumn; label: string }> = [
    { id: "running", label: "Running" },
    { id: "waiting", label: "Waiting" },
    { id: "idle", label: "Idle" },
    { id: "done", label: "Done" },
  ];

  $: buckets = (() => {
    const out: Record<KanbanColumn, AgentRef[]> = {
      running: [],
      waiting: [],
      idle: [],
      done: [],
    };
    for (const a of $agents) {
      out[bucketForStatus(a.status)].push(a);
    }
    return out;
  })();
</script>

<div
  data-kanban
  {...scopeAttrs(scope)}
  style="
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px; border: 1px solid {$theme.border};
    border-radius: 6px; background: {$theme.bgSurface};
  "
>
  {#if title}
    <div
      data-kanban-header
      style="
        font-size: 11px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.5px; color: {$theme.fgDim};
      "
    >
      {title}
    </div>
  {/if}

  <div
    data-kanban-columns
    style="
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    "
  >
    {#each COLUMN_DEFS as col (col.id)}
      <div
        data-kanban-column={col.id}
        style="
          display: flex; flex-direction: column; gap: 6px;
          background: {$theme.bg};
          border: 1px solid {$theme.border}; border-radius: 4px;
          padding: 8px; min-height: 80px;
        "
      >
        <div
          data-kanban-column-header
          style="
            font-size: 10px; text-transform: uppercase; font-weight: 600;
            letter-spacing: 0.5px; color: {$theme.fgDim};
            display: flex; align-items: center; gap: 6px;
          "
        >
          <span
            aria-hidden="true"
            style="
              width: 6px; height: 6px; border-radius: 50%;
              background: {statusColor(col.id)};
            "
          ></span>
          <span>{col.label}</span>
          <span
            role="status"
            aria-live="polite"
            style="margin-left: auto; color: {$theme.fgDim};"
            >{buckets[col.id].length}</span
          >
        </div>

        {#if buckets[col.id].length === 0}
          <div
            data-kanban-empty
            style="color: {$theme.fgDim}; font-style: italic; font-size: 11px;"
          >
            No agents
          </div>
        {:else}
          {#each buckets[col.id] as a (a.agentId)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              data-kanban-card
              data-agent-id={a.agentId}
              on:click={() => jumpToAgent(api, a)}
              style="
                display: flex; flex-direction: column; gap: 2px;
                padding: 6px 8px; cursor: pointer;
                background: {$theme.bgSurface};
                border: 1px solid {$theme.border};
                border-radius: 4px;
                color: {$theme.fg}; font-size: 11px;
              "
              on:mouseenter={(e) => {
                const el = e.currentTarget;
                if (el instanceof HTMLElement)
                  el.style.background = $theme.bgHighlight;
              }}
              on:mouseleave={(e) => {
                const el = e.currentTarget;
                if (el instanceof HTMLElement)
                  el.style.background = $theme.bgSurface;
              }}
              title="Jump to {a.agentName}"
            >
              <span
                style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >{a.agentName}</span
              >
              <span
                style="color: {$theme.fgDim}; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
              >
                {workspaceNameFor(api, a.workspaceId)}
              </span>
              <span style="color: {$theme.fgDim}; font-size: 10px;"
                >{timeAgo(a.lastStatusChange)}</span
              >
            </div>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</div>
