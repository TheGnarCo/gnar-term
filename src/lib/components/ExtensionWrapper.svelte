<script lang="ts">
  import { setExtensionAPI } from "../extension-context";
  import type { ExtensionAPI } from "../extension-types";

  export let api: ExtensionAPI;
  export let component: unknown;
  export let props: Record<string, unknown> = {};

  // Set context during component init so child can call getExtensionAPI()
  setExtensionAPI(api);
</script>

<svelte:component this={component} {...props} />
