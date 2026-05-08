<script lang="ts">
  /**
   * Body for the per-workspace Claude Settings Dashboard. Registered as a
   * hidden surface type (`dashboard:claude-settings`) and mounted via
   * PaneView's registry surface render path. The spawn flow seeds
   * `surface.props.rootWorkspaceId`, which we project into a
   * DashboardHostContext so ClaudeSettingsWidget resolves its workspace
   * via the standard host-scope rules.
   */
  import { setDashboardHost } from "../../../lib/contexts/dashboard-host";
  import ClaudeSettingsWidget from "./ClaudeSettingsWidget.svelte";

  export let rootWorkspaceId: string | undefined = undefined;

  setDashboardHost({
    metadata: {
      ...(typeof rootWorkspaceId === "string" ? { rootWorkspaceId } : {}),
    },
  });
</script>

<ClaudeSettingsWidget />
