<script lang="ts">
  import { theme } from "../stores/theme";
  import { activeWorkspace, workspaces } from "../stores/workspace";
  import { getWorkspaceStatus } from "../services/status-registry";
  import { GIT_STATUS_SOURCE } from "../services/git-status-service";
  import type { StatusItem } from "../types/status";

  export let workspaceId: string;
  export let accentColor: string | undefined = undefined;

  $: isActiveWorkspace = $activeWorkspace?.id === workspaceId;

  $: statusStore = getWorkspaceStatus(workspaceId);
  $: items = $statusStore.filter((item) => item.source === GIT_STATUS_SOURCE);

  $: currentWs = $workspaces.find((w) => w.id === workspaceId);
  $: workspaceMetadata = (currentWs?.metadata ?? {}) as Record<string, unknown>;
  $: isNested = Boolean(workspaceMetadata.groupId);
  $: isWorktree = Boolean(workspaceMetadata.worktreePath);
  $: worktreeBranch =
    typeof workspaceMetadata.branch === "string"
      ? (workspaceMetadata.branch as string)
      : undefined;

  $: cwdItem = items.find((i) => i.id.endsWith(":cwd"));
  $: branchItem = items.find((i) => i.id.endsWith(":branch"));
  $: prItem = items.find((i) => i.id.endsWith(":pr"));
  $: dirtyItem = items.find((i) => i.id.endsWith(":dirty"));

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

  function prCiVariant(
    item: StatusItem,
  ): "success" | "warning" | "error" | "muted" {
    const ci = item.metadata?.ciStatus;
    if (ci === "passing") return "success";
    if (ci === "failing") return "error";
    return "muted";
  }

  $: topRowHasContent = Boolean(cwdItem || branchItem);
  // Inactive rows collapse to the top line (cwd + branch); PR and dirty
  // details only render for the active workspace so the sidebar stays
  // scannable.
  $: bottomRowHasContent = isActiveWorkspace && Boolean(prItem || dirtyItem);
  $: nestedRowHasContent =
    Boolean(worktreeBranch) || (isActiveWorkspace && Boolean(dirtyItem));
</script>

{#if isNested}
  <!-- Normal nested workspaces share a repo with their project — their
       branch/dirty state duplicates the ProjectStatusLine shown on the
       project row. Only worktree workspaces (unique branch + tree) get
       their own inline git info. -->
  {#if isWorktree && nestedRowHasContent}
    <div
      style="padding: 0 12px 6px 6px; display: flex; align-items: center; gap: 6px; overflow: hidden; line-height: 1.2;"
    >
      {#if worktreeBranch}
        <span
          style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
          title={`worktree branch: ${worktreeBranch}`}>⌥ {worktreeBranch}</span
        >
      {/if}
      {#if worktreeBranch && dirtyItem && isActiveWorkspace}
        <span
          aria-hidden="true"
          style="font-size: 10px; color: {fgMuted}; opacity: 0.4;">|</span
        >
      {/if}
      {#if dirtyItem && isActiveWorkspace}
        {#if dirtyItem.action && isActiveWorkspace}
          <button
            style="font-size: 10px; color: {variantColor(
              dirtyItem.variant,
              fgMuted,
            )}; text-decoration: underline; cursor: pointer; white-space: nowrap; background: none; border: none; padding: 0; font-family: inherit;"
            title={dirtyItem.tooltip || dirtyItem.label}
            aria-label={dirtyItem.tooltip || dirtyItem.label}
            on:click|stopPropagation={() => handleAction(dirtyItem.action)}
            >{dirtyItem.label}</button
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
    {#if cwdItem}
      <div style="display: flex; align-items: center; min-width: 0;">
        <span
          style="font-size: 10px; color: {variantColor(
            cwdItem.variant,
            fgMuted,
          )}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; display: inline-flex; align-items: center; gap: 3px;"
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
          )}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; display: inline-flex; align-items: center; gap: 3px;"
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

    {#if bottomRowHasContent}
      <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
        {#if prItem}
          {@const variant = prItem.metadata?.prNumber
            ? prCiVariant(prItem)
            : (prItem.variant ?? "muted")}
          {#if prItem.action && isActiveWorkspace}
            <button
              style="font-size: 10px; color: {variantColor(
                variant,
                fgMuted,
              )}; text-decoration: underline; cursor: pointer; white-space: nowrap; display: inline-flex; gap: 4px; align-items: center; background: none; border: none; padding: 0; font-family: inherit;"
              title={prItem.tooltip || prItem.label}
              aria-label={prItem.tooltip || prItem.label}
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
            </button>
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
            <button
              style="font-size: 10px; color: {variantColor(
                dirtyItem.variant,
                fgMuted,
              )}; text-decoration: underline; cursor: pointer; white-space: nowrap; background: none; border: none; padding: 0; font-family: inherit;"
              title={dirtyItem.tooltip || dirtyItem.label}
              aria-label={dirtyItem.tooltip || dirtyItem.label}
              on:click|stopPropagation={() => handleAction(dirtyItem.action)}
              >{dirtyItem.label}</button
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
