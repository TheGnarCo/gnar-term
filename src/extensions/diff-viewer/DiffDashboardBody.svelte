<script lang="ts">
  /**
   * Diff dashboard body — registered as a hidden surface type
   * (`dashboard:diff`) by the diff-viewer extension. The spawn flow
   * seeds `surface.props.rootWorkspaceId`; we resolve it here, then
   * mount DiffSurface against the workspace's repo path.
   */
  import { workspaces } from "../../lib/stores/workspace";
  import DiffSurface from "./DiffSurface.svelte";

  export let rootWorkspaceId: string | undefined = undefined;

  $: workspace =
    typeof rootWorkspaceId === "string"
      ? $workspaces.find((w) => w.id === rootWorkspaceId)
      : undefined;
  $: repoPath = workspace?.path;
</script>

{#if repoPath}
  {#key repoPath}
    <DiffSurface {repoPath} baseBranch="HEAD" />
  {/key}
{/if}
