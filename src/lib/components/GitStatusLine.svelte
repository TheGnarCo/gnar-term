<script lang="ts">
  import { theme } from "../stores/theme";
  import { activeWorkspace, nestedWorkspaces } from "../stores/workspace";
  import { getWorkspaceStatus } from "../services/status-registry";
  import { GIT_STATUS_SOURCE } from "../services/git-status-service";
  import { wsMeta } from "../services/service-helpers";
  import type { StatusItem } from "../types/status";

  export let workspaceId: string;
  export let accentColor: string | undefined = undefined;

  $: isActiveWorkspace = $activeWorkspace?.id === workspaceId;

  $: statusStore = getWorkspaceStatus(workspaceId);
  $: items = $statusStore.filter((item) => item.source === GIT_STATUS_SOURCE);

  $: currentWs = $nestedWorkspaces.find((w) => w.id === workspaceId);
  $: workspaceMetadata = currentWs ? wsMeta(currentWs) : {};
  $: isNested = Boolean(workspaceMetadata.parentWorkspaceId);
  $: isWorktree = Boolean(workspaceMetadata.worktreePath);
  $: worktreeBranch = workspaceMetadata.branch;

  $: cwdItem = items.find((i) => i.id.endsWith(":cwd"));
  $: branchItem = items.find((i) => i.id.endsWith(":branch"));
  $: worktreeDirtyItem = items.find((i) => i.id.endsWith(":dirty"));

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
    const event = new CustomEvent("status-action", {
      detail: action,
      bubbles: true,
    });
    document.dispatchEvent(event);
  }

  $: topRowHasContent = Boolean(cwdItem || branchItem);
</script>

{#if isNested}
  <!-- Nested nestedWorkspaces show git branch info (matching container row style).
       Worktree nestedWorkspaces show only their own branch, not the parent repo's branch. -->
  {#if !isWorktree && branchItem}
    <div
      style="display: flex; align-items: center; gap: 4px; overflow: hidden; line-height: 1.2;"
    >
      <span
        style="font-size: 11px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-flex; align-items: center; gap: 4px;"
        title={branchItem.tooltip || branchItem.label}
      >
        <span
          style="color: {accentColor ?? fgMuted}; opacity: 0.8; flex-shrink: 0;"
          >⎇</span
        >
        {branchItem.label}
      </span>
    </div>
  {/if}
  {#if isWorktree && worktreeBranch}
    <div
      style="display: flex; align-items: center; gap: 4px; overflow: hidden; line-height: 1.2;"
    >
      <span
        style="font-size: 11px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-flex; align-items: center; gap: 4px;"
        title={`worktree branch: ${worktreeBranch}`}
        ><span
          style="color: {accentColor ?? fgMuted}; opacity: 0.8; flex-shrink: 0;"
          >⎇</span
        >
        {worktreeBranch}</span
      >
      {#if worktreeDirtyItem && isActiveWorkspace}
        <span
          aria-hidden="true"
          style="font-size: 10px; color: {fgMuted}; opacity: 0.4;">|</span
        >
      {/if}
      {#if worktreeDirtyItem && isActiveWorkspace}
        {#if worktreeDirtyItem.action && isActiveWorkspace}
          <button
            style="font-size: 10px; color: {variantColor(
              worktreeDirtyItem.variant,
              fgMuted,
            )}; text-decoration: underline; cursor: pointer; white-space: nowrap; background: none; border: none; padding: 0; font-family: inherit;"
            title={worktreeDirtyItem.tooltip || worktreeDirtyItem.label}
            aria-label={worktreeDirtyItem.tooltip || worktreeDirtyItem.label}
            on:click|stopPropagation={() =>
              handleAction(worktreeDirtyItem.action)}
            >{worktreeDirtyItem.label}</button
          >
        {:else}
          <span
            style="font-size: 10px; color: {variantColor(
              worktreeDirtyItem.variant,
              fgMuted,
            )}; white-space: nowrap;"
            title={worktreeDirtyItem.tooltip || worktreeDirtyItem.label}
            >{worktreeDirtyItem.label}</span
          >
        {/if}
      {/if}
    </div>
  {/if}
{:else if topRowHasContent}
  <div
    style="padding: 0 12px 2px 6px; display: flex; flex-direction: column; gap: 2px; overflow: hidden; line-height: 1.2;"
  >
    {#if cwdItem}
      <div style="display: flex; align-items: center; min-width: 0;">
        <span
          style="font-size: 10px; color: {variantColor(
            cwdItem.variant,
            fgMuted,
          )}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; display: inline-flex; align-items: center; gap: 4px;"
          title={cwdItem.tooltip || cwdItem.label}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill={accentColor ?? "currentColor"}
            style="flex-shrink: 0; opacity: 0.7;"
          >
            <path
              d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.062 1.5H13.5A1.5 1.5 0 0 1 15 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z"
            />
          </svg>
          {cwdItem.label}
        </span>
      </div>
    {/if}
    {#if branchItem}
      <div style="display: flex; align-items: center; min-width: 0;">
        <span
          style="font-size: 10px; color: {variantColor(
            branchItem.variant,
            fgMuted,
          )}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; display: inline-flex; align-items: center; gap: 4px;"
          title={branchItem.tooltip || branchItem.label}
        >
          <span
            style="color: {accentColor ??
              fgMuted}; opacity: 0.8; flex-shrink: 0;">⎇</span
          >
          {branchItem.label}
        </span>
      </div>
    {/if}
  </div>
{/if}
