<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import type { StatusItem } from "../api";

  export let workspaceId: string;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const activeWs = api.activeWorkspace;
  $: isActiveWorkspace = $activeWs?.id === workspaceId;

  $: statusStore = api.getWorkspaceStatus(workspaceId);
  $: items = $statusStore.filter((item) => item.source === "git-status");

  // fgMuted is an indexed property — cast to string for type safety
  let fgMuted: string;
  $: fgMuted = ($theme["fgMuted"] ?? $theme.fgDim) as string;

  const VARIANT_COLORS: Record<string, string> = {
    success: "#4ec957",
    warning: "#e8b73a",
    error: "#e85454",
    muted: "#888888",
  };

  function variantColor(variant: string | undefined, fallback: string): string {
    if (!variant || variant === "default") return fallback;
    return VARIANT_COLORS[variant] ?? fallback;
  }

  function handleAction(action: StatusItem["action"]) {
    if (!action) return;
    // Dispatch as custom event for App.svelte to handle (open-url, etc.)
    const event = new CustomEvent("status-action", {
      detail: action,
      bubbles: true,
    });
    document.dispatchEvent(event);
  }
</script>

{#if items.length > 0}
  <div
    style="padding: 0 12px 4px; display: flex; align-items: center; gap: 8px; overflow: hidden;"
  >
    {#each items as item (item.id)}
      {#if item.category === "pr" && item.metadata?.prNumber}
        <span
          style="font-size: 10px; display: inline-flex; align-items: center; gap: 2px;"
        >
          {#if item.action && isActiveWorkspace}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              style="color: {variantColor(
                item.metadata?.ciStatus === 'passing'
                  ? 'success'
                  : item.metadata?.ciStatus === 'failing'
                    ? 'error'
                    : 'muted',
                fgMuted,
              )}; text-decoration: underline; cursor: pointer;"
              on:click|stopPropagation={() => handleAction(item.action)}
              >#{item.metadata.prNumber}</span
            >
          {:else}
            <span
              style="color: {variantColor(
                item.metadata?.ciStatus === 'passing'
                  ? 'success'
                  : item.metadata?.ciStatus === 'failing'
                    ? 'error'
                    : 'muted',
                fgMuted,
              )};">#{item.metadata.prNumber}</span
            >
          {/if}
          {#if item.metadata?.reviewState}
            <span style="color: {variantColor(item.variant, fgMuted)};"
              >[{item.metadata.reviewState}]</span
            >
          {/if}
        </span>
      {:else if item.action && isActiveWorkspace}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          style="font-size: 10px; color: {variantColor(
            item.variant,
            fgMuted,
          )}; text-decoration: underline; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
          title={item.tooltip || item.label}
          on:click|stopPropagation={() => handleAction(item.action)}
          >{item.label}</span
        >
      {:else}
        <span
          style="font-size: 10px; color: {variantColor(
            item.variant,
            fgMuted,
          )}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
          title={item.tooltip || item.label}>{item.label}</span
        >
      {/if}
    {/each}
  </div>
{/if}
