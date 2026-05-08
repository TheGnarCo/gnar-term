<script lang="ts">
  import { workspaces } from "../../lib/stores/workspace";
  import { getDashboardHost } from "../../lib/contexts/dashboard-host";
  import DiffSurface from "./DiffSurface.svelte";

  const host = getDashboardHost();
  $: rootWorkspaceId =
    typeof host?.metadata.rootWorkspaceId === "string"
      ? host.metadata.rootWorkspaceId
      : null;
  $: workspace = rootWorkspaceId
    ? $workspaces.find((w) => w.id === rootWorkspaceId)
    : undefined;
  $: repoPath = workspace?.path;
</script>

{#if repoPath}
  {#key repoPath}
    <DiffSurface {repoPath} baseBranch="HEAD" />
  {/key}
{/if}
