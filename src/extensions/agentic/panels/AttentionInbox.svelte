<script lang="ts">
  // AttentionInbox — newest-first list of attention events. Store order is trusted;
  // no re-sort is applied here (store contract: newest-first, see api.ts attention store).
  // API is provided via Svelte context (EXTENSION_API_KEY), set by ExtensionWrapper.
  import { getContext } from "svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    type AttentionEventRef,
  } from "../../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const attention = api.attention;

  function handleRowClick(event: AttentionEventRef) {
    // Focus the surface first (only if surfaceId is defined), then always dismiss.
    if (event.surfaceId !== undefined) {
      api.focusSurface(event.surfaceId);
    }
    api.dismissAttention(event.paneId);
  }

  function relativeTime(createdAt: number): string {
    const diff = Date.now() - createdAt;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  function kindClass(kind: AttentionEventRef["kind"]): string {
    switch (kind) {
      case "awaiting_input":
        return "kind-awaiting";
      case "errored":
        return "kind-errored";
      case "completed":
        return "kind-completed";
      case "notify":
        return "kind-notify";
      case "progress":
        return "kind-progress";
      default:
        return "kind-notify";
    }
  }
</script>

{#if $attention.length === 0}
  <p class="empty-state">Inbox clear.</p>
{:else}
  <div class="inbox-list">
    {#each $attention as event (event.paneId + "-" + event.createdAt)}
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div
        class="inbox-row"
        data-attention-row={event.paneId}
        role="button"
        tabindex="0"
        onclick={() => handleRowClick(event)}
        onkeydown={(e) => e.key === "Enter" && handleRowClick(event)}
      >
        <div class="row-main">
          <span class="row-title">{event.title ?? event.kind}</span>
          <span class="kind-pill {kindClass(event.kind)}">{event.kind}</span>
        </div>
        {#if event.body}
          <p class="row-body">{event.body}</p>
        {/if}
        <span class="row-time">{relativeTime(event.createdAt)}</span>
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

  .inbox-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .inbox-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.5rem 0.6rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    cursor: pointer;
  }

  .inbox-row:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .row-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .row-title {
    font-size: 0.8rem;
    font-weight: 500;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-body {
    font-size: 0.7rem;
    opacity: 0.6;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-time {
    font-size: 0.65rem;
    opacity: 0.4;
  }

  .kind-pill {
    font-size: 0.6rem;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .kind-awaiting {
    background: rgba(234, 179, 8, 0.2);
    color: #facc15;
  }
  .kind-errored {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }
  .kind-completed {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
  }
  .kind-notify {
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
  }
  .kind-progress {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
  }
</style>
