<script lang="ts">
  // Stub used by markdown-previewer-components.test.ts to verify the markdown
  // previewer propagates DashboardHostContext into mounted gnar:* widgets.
  // Exposes the host-metadata keys via data-* attributes for test inspection.
  import { getDashboardHost } from "../lib/contexts/dashboard-host";

  const host = getDashboardHost();
  const parentWorkspaceId =
    host && typeof host.metadata.parentWorkspaceId === "string"
      ? host.metadata.parentWorkspaceId
      : "";
  const isGlobal =
    host?.metadata.isGlobalAgenticDashboard === true ? "yes" : "no";
</script>

<div
  data-host-stub-widget
  data-host-present={host ? "yes" : "no"}
  data-host-parent-workspace-id={parentWorkspaceId}
  data-host-global={isGlobal}
></div>
