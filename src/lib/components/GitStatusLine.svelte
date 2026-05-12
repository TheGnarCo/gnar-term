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

  // Matches prettyCwd() in git-status-service so the seed value renders
  // at the same width as the live label (no width jump when polling
  // resolves and swaps the value in).
  function tildify(path: string): string {
    return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
  }

  // Seed the cwd/branch rows from the workspace record so the banner
  // paints at its final height on first render. Live polling later
  // swaps in the authoritative values from the status registry.
  $: seedCwd = currentWs?.path ? tildify(currentWs.path) : "";
  $: cwdLabel = cwdItem?.label ?? seedCwd;
  $: cwdVariant = cwdItem?.variant;
  $: cwdTitle = cwdItem?.tooltip ?? cwdItem?.label ?? currentWs?.path ?? "";

  $: branchLabel = branchItem?.label ?? (currentWs?.isGit ? "…" : "");
  $: branchVariant = branchItem?.variant;
  $: branchTitle = branchItem?.tooltip ?? branchItem?.label ?? "";

  $: topRowHasContent = Boolean(cwdLabel || branchLabel);
</script>

{#if isChild}
  <!-- Child workspaces show git branch info (matching container row style).
       Worktree workspaces show only their own branch, not the parent repo's branch. -->
  {#if !isWorktree && branchItem}
    <div
      style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; line-height: 1.2;"
    >
      <span
        style="color: {accentColor ??
          fgMuted}; opacity: 0.8; flex-shrink: 0; font-size: 11px;"
        aria-hidden="true">⎇</span
      >
      <span
        style="font-size: 11px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 auto;"
        title={branchItem.tooltip || branchItem.label}
      >
        {branchItem.label}
      </span>
    </div>
  {/if}
  {#if isWorktree && worktreeBranch}
    <div
      style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; line-height: 1.2;"
    >
      <span
        style="color: {accentColor ??
          fgMuted}; opacity: 0.8; flex-shrink: 0; font-size: 11px;"
        aria-hidden="true">⎇</span
      >
      <span
        style="font-size: 11px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 auto;"
        title={`worktree branch: ${worktreeBranch}`}
      >
        {worktreeBranch}
      </span>
      {#if worktreeDirtyItem && isActiveWorkspace}
        <span
          aria-hidden="true"
          style="font-size: 10px; color: {fgMuted}; opacity: 0.4; flex-shrink: 0;"
          >|</span
        >
        <span
          style="font-size: 10px; color: {variantColor(
            worktreeDirtyItem.variant,
            fgMuted,
          )}; white-space: nowrap; flex-shrink: 0;"
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
    {#if cwdLabel}
      <div
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
        title={cwdTitle}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill={accentColor ?? "currentColor"}
          style="flex-shrink: 0; opacity: 0.7;"
          aria-hidden="true"
        >
          <path
            d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.062 1.5H13.5A1.5 1.5 0 0 1 15 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z"
          />
        </svg>
        <span
          style="font-size: 10px; color: {variantColor(
            cwdVariant,
            fgMuted,
          )}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 auto;"
        >
          {cwdLabel}
        </span>
      </div>
    {/if}
    {#if branchLabel}
      <div
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
        title={branchTitle}
      >
        <span
          style="color: {accentColor ??
            fgMuted}; opacity: 0.8; flex-shrink: 0; font-size: 10px;"
          aria-hidden="true">⎇</span
        >
        <span
          style="font-size: 10px; color: {variantColor(
            branchVariant,
            fgMuted,
          )}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 auto;"
        >
          {branchLabel}
        </span>
      </div>
    {/if}
  </div>
{/if}
