<script lang="ts">
  import { theme } from "../stores/theme";
  import { activeWorkspace, workspaces } from "../stores/workspace";
  import { getWorkspaceStatus } from "../services/status-registry";
  import { GIT_STATUS_SOURCE } from "../services/git-status-service";

  export let workspaceId: string;
  export let accentColor: string | undefined = undefined;

  $: isActiveWorkspace = $activeWorkspace?.id === workspaceId;

  $: statusStore = getWorkspaceStatus(workspaceId);
  $: items = $statusStore.filter((item) => item.source === GIT_STATUS_SOURCE);

  $: currentWs = $workspaces.find((w) => w.id === workspaceId);
  $: isChild = Boolean(currentWs?.rootWorkspaceId);
  $: isWorktree = Boolean(
    (currentWs as { worktreePath?: string } | undefined)?.worktreePath,
  );
  $: worktreeBranch = (currentWs as { branch?: string } | undefined)?.branch;

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

  $: topRowHasContent = Boolean(cwdItem || branchItem);
</script>

{#if isChild}
  <!-- Child workspaces show git branch info (matching container row style).
       Worktree workspaces show only their own branch, not the parent repo's branch. -->
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
        <span
          style="font-size: 10px; color: {variantColor(
            worktreeDirtyItem.variant,
            fgMuted,
          )}; white-space: nowrap;"
          title={worktreeDirtyItem.tooltip || worktreeDirtyItem.label}
          >{worktreeDirtyItem.label}</span
        >
      {/if}
    </div>
  {/if}
{:else if topRowHasContent}
  <div
    style="padding: 0 0 0 6px; display: flex; flex-direction: column; gap: 0; flex: 1 1 auto; min-width: 0; overflow: hidden; line-height: 1.2;"
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
