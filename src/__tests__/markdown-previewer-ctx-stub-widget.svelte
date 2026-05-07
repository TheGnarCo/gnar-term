<script lang="ts">
  // Stub component used by markdown-previewer-components.test.ts to verify
  // that the markdown previewer propagates the owning extension's API
  // through the Svelte context when mounting gnar:* widgets. Asserts via
  // data-* attributes so the test can inspect without running Svelte
  // reactivity.
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY } from "../lib/extension-types";

  type MockApi = { marker?: string } | undefined;
  const api = getContext<MockApi>(EXTENSION_API_KEY);
</script>

<div
  data-ctx-stub-widget
  data-api-present={api ? "yes" : "no"}
  data-api-marker={api?.marker ?? ""}
></div>
