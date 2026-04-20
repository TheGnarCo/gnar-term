<script lang="ts">
  /**
   * AgentListSidebarTab — secondary sidebar tab body for the global
   * "Agents" tab. Installs a synthetic global DashboardHostContext so
   * AgentList surfaces every detected agent, mirroring what a
   * `gnar:agent-list` block inside the Global Agentic Dashboard
   * produces. Stage 7 removes this tab once the pseudo-workspace lands.
   *
   * Wrapped in a thin scrollable shell so the tab content scales down
   * to the secondary sidebar's width without overflowing.
   */
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import AgentList from "./AgentList.svelte";
  import { setDashboardHost } from "../../../lib/contexts/dashboard-host";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  setDashboardHost({ metadata: { isGlobalAgenticDashboard: true } });
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
