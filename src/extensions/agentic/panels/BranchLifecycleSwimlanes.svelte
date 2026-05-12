<script lang="ts">
  // BranchLifecycleSwimlanes — 5-column kanban for branch lifecycle states.
  // Subscribes to api.branchLifecycle (Map<branchId, BranchLifecycleEntry>).
  // API is provided via Svelte context (EXTENSION_API_KEY), set by ExtensionWrapper.
  import { getContext } from "svelte";
  import { derived } from "svelte/store";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    type BranchLifecycleEntry,
  } from "../../api";

  const COLUMNS = [
    "draft",
    "active",
    "awaiting_review",
    "in_review",
    "merged",
  ] as const;
  type Column = (typeof COLUMNS)[number];

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
            <div class="branch-card">
              <span class="branch-id">{branchId}</span>
              <span class="lifecycle-pill pill-{col}">{entry.lifecycle}</span>
              {#if entry.reason}
                <span class="branch-reason">{entry.reason}</span>
              {/if}
            </div>
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

  .pill-draft {
    background: rgba(255, 255, 255, 0.1);
  }
  .pill-active {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
  }
  .pill-awaiting_review {
    background: rgba(234, 179, 8, 0.2);
    color: #facc15;
  }
  .pill-in_review {
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
  }
  .pill-merged {
    background: rgba(168, 85, 247, 0.2);
    color: #c084fc;
  }
</style>
