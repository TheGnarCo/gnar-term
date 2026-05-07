<script lang="ts">
  import type { Component } from "svelte";
  import { setExtensionAPI } from "../extension-context";
  import type { ExtensionAPI } from "../extension-types";
  import {
    setDashboardHost,
    type DashboardHostContext,
  } from "../contexts/dashboard-host";

  export let api: ExtensionAPI;
  export let component: unknown;
  export let props: Record<string, unknown> = {};
  /**
   * Optional dashboard host metadata — when set, the wrapper installs a
   * `DashboardHostContext` that the wrapped widget can read via
   * `getDashboardHost()`. Real markdown previews inject this through the
   * mount-context path; tests that render widgets directly use this prop.
   */
  export let host: DashboardHostContext | undefined = undefined;

  // Set context during component init so child can call getExtensionAPI()
  setExtensionAPI(api);
  if (host) setDashboardHost(host);
</script>

<svelte:component this={component as Component} {...props} />
