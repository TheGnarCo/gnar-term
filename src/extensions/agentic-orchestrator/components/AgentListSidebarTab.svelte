<script lang="ts">
  /**
   * AgentListSidebarTab — secondary sidebar tab body for the global
   * "Agents" tab (P11). Mounts AgentList in global-scope mode (no
   * `dashboardId`), so the registry's full agent list renders here —
   * mirroring what `gnar:agent-list` produces with no config inside a
   * markdown preview.
   *
   * Wrapped in a thin scrollable shell so the tab content scales down
   * to the secondary sidebar's width without overflowing.
   */
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import AgentList from "./AgentList.svelte";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
</script>

<div
  data-agent-list-sidebar-tab
  style="
    padding: 8px;
    height: 100%;
    overflow-y: auto;
    background: {$theme.bg};
  "
>
  <AgentList title="All Agents" />
</div>
