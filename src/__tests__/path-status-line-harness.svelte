<script lang="ts">
  import { setContext } from "svelte";
  import { writable } from "svelte/store";
  import { EXTENSION_API_KEY } from "../lib/extension-types";
  import { themes } from "../lib/theme-data";
  import PathStatusLine from "../lib/components/PathStatusLine.svelte";

  export let target: { id: string; path: string | undefined; isGit: boolean };

  setContext(EXTENSION_API_KEY, {
    theme: writable(themes["github-dark"]),
    invoke: async () => undefined,
  });
</script>

<PathStatusLine {target} />
