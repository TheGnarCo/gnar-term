<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
</script>

<button
  title="Open Dashboard"
  on:click={() => api.openSurface("dashboard:dashboard", "Dashboard")}
  style="
    display: flex; align-items: center; gap: 6px;
    width: 100%; padding: 4px 12px;
    background: none; border: none; cursor: pointer;
    color: {$theme.fgDim}; font-size: 12px;
    text-align: left;
  "
>
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="1" y="1" width="6" height="6" rx="1" />
    <rect x="9" y="1" width="6" height="6" rx="1" />
    <rect x="1" y="9" width="6" height="6" rx="1" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </svg>
  Dashboard
</button>
