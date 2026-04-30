<script lang="ts">
  import { setContext } from "svelte";
  import { writable } from "svelte/store";
  import { EXTENSION_API_KEY } from "../lib/extension-types";
  import { themes } from "../lib/theme-data";
  import WorkspaceSectionContent from "../lib/components/WorkspaceSectionContent.svelte";

  export let groupId: string;

  setContext(EXTENSION_API_KEY, {
    theme: writable(themes["github-dark"]),
    invoke: async () => undefined,
  });
</script>

<WorkspaceSectionContent {groupId} containerBlockId="" />
