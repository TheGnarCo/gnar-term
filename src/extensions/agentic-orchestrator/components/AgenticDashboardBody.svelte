<script lang="ts">
  /**
   * Agentic Dashboard body — landing page for a workspace's Agentic
   * Dashboard. Registered as a hidden surface type
   * (`dashboard:agentic`) by the agentic-orchestrator extension and
   * mounted via PaneView's normal registry surface render path. The
   * spawn flow seeds `surface.props.rootWorkspaceId`, which we project
   * into a DashboardHostContext so embedded widgets (Kanban,
   * TaskSpawner, Issues) derive their scope unchanged.
   */
  import { workspaces } from "../../../lib/stores/workspace";
  import { setDashboardHost } from "../../../lib/contexts/dashboard-host";
  import { theme } from "../../../lib/stores/theme";
  import Kanban from "./Kanban.svelte";
  import TaskSpawner from "./TaskSpawner.svelte";
  import Issues from "./Issues.svelte";

  export let rootWorkspaceId: string | undefined = undefined;

  setDashboardHost({
    metadata: {
      ...(typeof rootWorkspaceId === "string" ? { rootWorkspaceId } : {}),
    },
  });

  $: workspace =
    typeof rootWorkspaceId === "string"
      ? $workspaces.find((w) => w.id === rootWorkspaceId)
      : undefined;
</script>

<div
  data-agentic-dashboard-body
  data-workspace-id={workspace?.id ?? ""}
  style="
    flex: 1; min-width: 0; min-height: 0; overflow: auto;
    padding: 24px 32px;
    display: flex; flex-direction: column; gap: 20px;
    background: {$theme.bg}; color: {$theme.fg};
  "
>
  {#if workspace}
    <header style="display: flex; flex-direction: column; gap: 4px;">
      <h1 style="margin: 0; font-size: 18px; font-weight: 600;">
        {workspace.name} Agents
      </h1>
      <p style="margin: 0; color: {$theme.fgDim}; font-size: 12px;">
        Spawn and monitor agents working inside <code
          style="font-family: monospace;">{workspace.path}</code
        >.
      </p>
    </header>

    <Kanban />

    <TaskSpawner />

    <section style="display: flex; flex-direction: column; gap: 8px;">
      <h2 style="margin: 0; font-size: 14px; font-weight: 600;">Open Issues</h2>
      <Issues state="open" />
    </section>
  {/if}
</div>
