<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const settings = api.settings;

  let name = "";
  let description = "";
  let avatarUrl = "";
  let initials = "";
  let imgError = false;

  $: {
    // Re-read settings whenever the config store changes
    void $settings;
    name = (api.getSetting<string>("name") || "User").trim();
    description = (api.getSetting<string>("description") || "gnar-term").trim();
    avatarUrl = (api.getSetting<string>("avatarUrl") || "").trim();
    initials = name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
    imgError = false;
  }
</script>

<div
  style="
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
"
>
  {#if avatarUrl && !imgError}
    <img
      src={avatarUrl}
      alt={name}
      on:error={() => (imgError = true)}
      style="
        width: 32px; height: 32px; border-radius: 50%;
        object-fit: cover; flex-shrink: 0;
      "
    />
  {:else}
    <div
      style="
      width: 32px; height: 32px; border-radius: 50%;
      background: {$theme.accent}; color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 600; flex-shrink: 0;
    "
    >
      {initials}
    </div>
  {/if}
  <div style="min-width: 0; overflow: hidden;">
    <div
      style="
      font-size: 12px; font-weight: 500; color: {$theme.fg};
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    "
    >
      {name}
    </div>
    <div style="font-size: 10px; color: {$theme.fgDim};">{description}</div>
  </div>
</div>
