<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import type { StatusItem } from "../api";

  export let workspaceId: string;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const activeWs = api.activeWorkspace;
  const wsStore = api.workspaces;
  $: isActiveWorkspace = $activeWs?.id === workspaceId;

  $: statusStore = api.getWorkspaceStatus(workspaceId);
  $: items = $statusStore.filter((item) => item.source === "git-status");

  // Nesting detection: if this workspace is tagged with a projectId it
  // lives inside a Project banner, which already shows cwd+branch. We
  // collapse this subtitle to a single row ("worktree | diff") to avoid
  // repeating the information.
  $: currentWs = $wsStore.find((w) => w.id === workspaceId);
  $: workspaceMetadata = (currentWs?.metadata ?? {}) as Record<string, unknown>;
  $: isNested = Boolean(workspaceMetadata.projectId);
  $: worktreeBranch =
    typeof workspaceMetadata.branch === "string"
      ? (workspaceMetadata.branch as string)
      : undefined;

  // status-registry stores items under a composite id ("git-status:{wsId}:{key}")
  // so matching against the bare key requires looking at the suffix.
  $: cwdItem = items.find((i) => i.id.endsWith(":cwd"));
  $: branchItem = items.find((i) => i.id.endsWith(":branch"));
  $: prItem = items.find((i) => i.id.endsWith(":pr"));
  $: dirtyItem = items.find((i) => i.id.endsWith(":dirty"));

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

  function prCiVariant(
    item: StatusItem,
  ): "success" | "warning" | "error" | "muted" {
    const ci = item.metadata?.ciStatus;
    if (ci === "passing") return "success";
    if (ci === "failing") return "error";
    return "muted";
  }

  // Rows to render. Nested workspaces only get the "worktree | diff" row
  // so the Project banner above remains the single source for cwd/branch.
  $: topRowHasContent = Boolean(cwdItem || branchItem);
  $: bottomRowHasContent = Boolean(prItem || dirtyItem);
  $: nestedRowHasContent = Boolean(worktreeBranch || dirtyItem);
</script>

{#if isNested}
  {#if nestedRowHasContent}
    <div
      style="padding: 0 12px 6px 6px; display: flex; align-items: center; gap: 6px; overflow: hidden; line-height: 1.2;"
    >
      {#if worktreeBranch}
        <span
          style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
          title={`worktree branch: ${worktreeBranch}`}>⌥ {worktreeBranch}</span
        >
      {/if}
      {#if worktreeBranch && dirtyItem}
        <span
          aria-hidden="true"
          style="font-size: 10px; color: {fgMuted}; opacity: 0.4;">|</span
        >
      {/if}
      {#if dirtyItem}
        {#if dirtyItem.action && isActiveWorkspace}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            style="font-size: 10px; color: {variantColor(
              dirtyItem.variant,
              fgMuted,
            )}; text-decoration: underline; cursor: pointer; white-space: nowrap;"
            title={dirtyItem.tooltip || dirtyItem.label}
            on:click|stopPropagation={() => handleAction(dirtyItem.action)}
            >{dirtyItem.label}</span
          >
        {:else}
          <span
            style="font-size: 10px; color: {variantColor(
              dirtyItem.variant,
              fgMuted,
            )}; white-space: nowrap;"
            title={dirtyItem.tooltip || dirtyItem.label}>{dirtyItem.label}</span
          >
        {/if}
      {/if}
    </div>
  {/if}
{:else if topRowHasContent || bottomRowHasContent}
  <div
    style="padding: 0 12px 6px 6px; display: flex; flex-direction: column; gap: 2px; overflow: hidden; line-height: 1.2;"
  >
    {#if topRowHasContent}
      <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
        {#if cwdItem}
          <span
            style="font-size: 10px; color: {variantColor(
              cwdItem.variant,
              fgMuted,
            )}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;"
            title={cwdItem.tooltip || cwdItem.label}>{cwdItem.label}</span
          >
        {/if}
        {#if cwdItem && branchItem}
          <span
            aria-hidden="true"
            style="font-size: 10px; color: {fgMuted}; opacity: 0.4; flex-shrink: 0;"
            >|</span
          >
        {/if}
        {#if branchItem}
          <span
            style="font-size: 10px; color: {variantColor(
              branchItem.variant,
              fgMuted,
            )}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;"
            title={branchItem.tooltip || branchItem.label}
            >⎇ {branchItem.label}</span
          >
        {/if}
      </div>
    {/if}

    {#if bottomRowHasContent}
      <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
        {#if prItem}
          {@const variant = prItem.metadata?.prNumber
            ? prCiVariant(prItem)
            : (prItem.variant ?? "muted")}
          {#if prItem.action && isActiveWorkspace}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              style="font-size: 10px; color: {variantColor(
                variant,
                fgMuted,
              )}; text-decoration: underline; cursor: pointer; white-space: nowrap; display: inline-flex; gap: 4px; align-items: center;"
              title={prItem.tooltip || prItem.label}
              on:click|stopPropagation={() => handleAction(prItem.action)}
            >
              {prItem.metadata?.prNumber
                ? `PR #${prItem.metadata.prNumber}`
                : prItem.label}
              {#if prItem.metadata?.reviewState}
                <span style="opacity: 0.7;"
                  >[{prItem.metadata.reviewState}]</span
                >
              {/if}
            </span>
          {:else}
            <span
              style="font-size: 10px; color: {variantColor(
                variant,
                fgMuted,
              )}; white-space: nowrap; display: inline-flex; gap: 4px; align-items: center;"
              title={prItem.tooltip || prItem.label}
            >
              {prItem.metadata?.prNumber
                ? `PR #${prItem.metadata.prNumber}`
                : prItem.label}
              {#if prItem.metadata?.reviewState}
                <span style="opacity: 0.7;"
                  >[{prItem.metadata.reviewState}]</span
                >
              {/if}
            </span>
          {/if}
        {/if}
        {#if prItem && dirtyItem}
          <span
            aria-hidden="true"
            style="font-size: 10px; color: {fgMuted}; opacity: 0.4; flex-shrink: 0;"
            >|</span
          >
        {/if}
        {#if dirtyItem}
          {#if dirtyItem.action && isActiveWorkspace}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              style="font-size: 10px; color: {variantColor(
                dirtyItem.variant,
                fgMuted,
              )}; text-decoration: underline; cursor: pointer; white-space: nowrap;"
              title={dirtyItem.tooltip || dirtyItem.label}
              on:click|stopPropagation={() => handleAction(dirtyItem.action)}
              >{dirtyItem.label}</span
            >
          {:else}
            <span
              style="font-size: 10px; color: {variantColor(
                dirtyItem.variant,
                fgMuted,
              )}; white-space: nowrap;"
              title={dirtyItem.tooltip || dirtyItem.label}
              >{dirtyItem.label}</span
            >
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}
