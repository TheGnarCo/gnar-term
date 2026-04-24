<script lang="ts">
  import { OWNED_KEYS } from "../../lib/settings-schema";

  export let settings: Record<string, unknown>;
  export let onChange: (key: string, value: unknown) => void;
  export let theme: { fg: string; fgDim: string; bg: string; border: string };

  $: otherEntries = Object.entries(settings).filter(
    ([k]) => !OWNED_KEYS.has(k),
  );

  function updateOther(key: string, rawVal: string) {
    try {
      onChange(key, JSON.parse(rawVal));
    } catch {
      onChange(key, rawVal);
    }
  }
</script>

{#if otherEntries.length === 0}
  <p style="color: {theme.fgDim}; font-size: 12px; margin: 0;">
    No additional settings.
  </p>
{:else}
  <div class="other-section">
    {#each otherEntries as [key, val]}
      <div class="other-row">
        <code class="other-key" style="color: {theme.fg};">{key}</code>
        <textarea
          rows={typeof val === "object" && val !== null ? 3 : 1}
          style="background: {theme.bg}; color: {theme.fg}; border: 1px solid {theme.border}; border-radius: 4px; padding: 3px 8px; font-size: 11px; font-family: monospace; flex: 1; resize: vertical;"
          on:change={(e) => updateOther(key, e.currentTarget.value)}
          >{JSON.stringify(val, null, 2)}</textarea
        >
      </div>
    {/each}
  </div>
{/if}

<style>
  .other-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .other-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .other-key {
    font-size: 11px;
    min-width: 160px;
    padding-top: 4px;
    flex-shrink: 0;
  }
</style>
