<script lang="ts">
  // BranchLifecycleSwimlanes — 5-column kanban for branch lifecycle states.
  // Subscribes to api.branchLifecycle (Map<branchId, BranchLifecycleEntry>).
  // API is provided via Svelte context (EXTENSION_API_KEY), set by ExtensionWrapper.
  import { getContext } from "svelte";
  import { derived, get } from "svelte/store";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    type BranchLifecycleEntry,
  } from "../../api";
  import { pillStyle, type PaletteKey } from "../palette";

  const COLUMNS = [
    "draft",
    "active",
    "awaiting_review",
    "in_review",
    "merged",
  ] as const;
  type Column = (typeof COLUMNS)[number];

  const COLUMN_PALETTE: Record<Column, PaletteKey> = {
    draft: "neutral",
    active: "success",
    awaiting_review: "attention",
    in_review: "info",
    merged: "accent",
  };

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const branchLifecycle = api.branchLifecycle;

  // Bucket entries by lifecycle column; skip abandoned entries entirely.
  // Within each column, sort alphabetically by branchId for deterministic display order.
  const bucketed = derived(branchLifecycle, ($map) => {
    const result = new Map<Column, Array<[string, BranchLifecycleEntry]>>();
    for (const col of COLUMNS) result.set(col, []);

    for (const [branchId, entry] of Array.from($map.entries())) {
      if (entry.lifecycle === "abandoned") continue;
      const col = entry.lifecycle as Column;
      if (result.has(col)) {
        result.get(col)!.push([branchId, entry]);
      }
    }

    // Sort alphabetically within each column
    for (const [, entries] of result) {
      entries.sort(([a], [b]) => a.localeCompare(b));
    }

    return result;
  });

  // Show hint when any entry has prStateKnown === false.
  const showPrHint = derived(branchLifecycle, ($map) => {
    for (const entry of $map.values()) {
      if (!entry.prStateKnown) return true;
    }
    return false;
  });

  function columnLabel(col: Column): string {
    switch (col) {
      case "draft":
        return "Draft";
      case "active":
        return "Active";
      case "awaiting_review":
        return "Awaiting Review";
      case "in_review":
        return "In Review";
      case "merged":
        return "Merged";
    }
  }

  // Resolve the surfaceId to focus when a branch card is clicked.
  // Chain: branchId → BranchDescriptor.paneId → matching agent → agent.surfaceId.
  // Returns null when no agent currently occupies the branch's pane (e.g.,
  // branch tracked by core but its agent has exited). Click becomes a no-op.
  function resolveSurfaceForBranch(branchId: string): string | null {
    const branch = api.listBranches().find((b) => b.branchId === branchId);
    if (!branch?.paneId) return null;
    const agent = get(api.agents).find((a) => a.paneId === branch.paneId);
    return agent?.surfaceId ?? null;
  }

  function handleCardClick(branchId: string) {
    const surfaceId = resolveSurfaceForBranch(branchId);
    if (surfaceId) api.focusSurface(surfaceId);
  }
</script>

{#if $branchLifecycle.size === 0}
  <p class="empty-state">No branches tracked yet.</p>
{:else}
  {#if $showPrHint}
    <div class="pr-hint" data-pr-hint>
      PR state unavailable — install gh CLI or sign in to see full lifecycle.
    </div>
  {/if}

  <div class="swimlanes">
    {#each COLUMNS as col}
      <div class="swimlane-column" data-lifecycle-column={col}>
        <h3 class="column-header">{columnLabel(col)}</h3>
        <div class="column-cards">
          {#each $bucketed.get(col) ?? [] as [branchId, entry] (branchId)}
            <button
              type="button"
              class="branch-card"
              data-branch-card={branchId}
              onclick={() => handleCardClick(branchId)}
            >
              <span class="branch-id">{branchId}</span>
              <span
                class="lifecycle-pill"
                data-lifecycle={col}
                style={pillStyle(COLUMN_PALETTE[col])}>{entry.lifecycle}</span
              >
              {#if entry.reason}
                <span class="branch-reason">{entry.reason}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .empty-state {
    font-size: 0.75rem;
    opacity: 0.4;
    margin: 0;
  }

  .pr-hint {
    font-size: 0.7rem;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    background: rgba(234, 179, 8, 0.1);
    color: #fbbf24;
    margin-bottom: 0.75rem;
  }

  .swimlanes {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    min-height: 80px;
  }

  .swimlane-column {
    flex: 1;
    min-width: 100px;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .column-header {
    font-size: 0.65rem;
    font-weight: 600;
    opacity: 0.5;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .column-cards {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .branch-card {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    font-size: 0.75rem;
    width: 100%;
    border: 0;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .branch-card:hover {
    background: rgba(255, 255, 255, 0.09);
  }

  .branch-id {
    font-family: monospace;
    font-size: 0.7rem;
    word-break: break-all;
  }

  .branch-reason {
    font-size: 0.65rem;
    opacity: 0.5;
  }

  .lifecycle-pill {
    font-size: 0.6rem;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    align-self: flex-start;
  }
</style>
