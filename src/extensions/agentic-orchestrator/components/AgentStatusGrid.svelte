<script lang="ts">
  /**
   * AgentStatusGrid — compact 2x2 status-chip grid rendered inside the
   * Global Agentic Dashboard's primary-sidebar row (in place of the
   * "Agents dashboard" label).
   *
   * Each chip is a colored dot + count for one of the four kanban
   * buckets (Running / Waiting / Idle / Done). Reuses the same
   * `bucketForStatus` + `statusColor` helpers as the Kanban widget so
   * the sidebar summary always agrees with what the Kanban shows.
   */
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import {
    bucketForStatus,
    statusColor,
    type KanbanColumn,
  } from "../widget-helpers";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const agents = api.agents;

  /**
   * The 2x2 grid renders in this fixed order:
   *   [Running] [Waiting]
   *   [Idle]    [Done]
   * Matching the Kanban column order so the user's spatial mental
   * model carries between the two surfaces.
   */
  const CHIPS: Array<{ id: KanbanColumn; label: string }> = [
    { id: "running", label: "Running" },
    { id: "waiting", label: "Waiting" },
    { id: "idle", label: "Idle" },
    { id: "done", label: "Done" },
  ];

  $: counts = (() => {
    const out: Record<KanbanColumn, number> = {
      running: 0,
      waiting: 0,
      idle: 0,
      done: 0,
    };
    for (const a of $agents) {
      out[bucketForStatus(a.status)] += 1;
    }
    return out;
  })();
</script>

<div
  data-agent-status-grid
  aria-label="Agent status counts"
  style="
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px 6px;
    flex: 1; min-width: 0;
  "
>
  {#each CHIPS as chip (chip.id)}
    {@const color = statusColor(chip.id)}
    {@const n = counts[chip.id]}
    <div
      data-agent-status-chip={chip.id}
      data-agent-status-count={n}
      title={`${n} ${chip.label.toLowerCase()}`}
      style="
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; line-height: 1.2;
        color: currentColor;
        opacity: {n > 0 ? 1 : 0.55};
        min-width: 0;
      "
    >
      <span
        aria-hidden="true"
        style="
          flex-shrink: 0;
          width: 8px; height: 8px; border-radius: 50%;
          background: {color};
        "
      ></span>
      <span style="font-variant-numeric: tabular-nums; font-weight: 600;"
        >{n}</span
      >
    </div>
  {/each}
</div>
