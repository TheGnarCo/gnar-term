<script lang="ts">
  import type { Component } from "svelte";
  import { getMarkdownComponent } from "../services/markdown-component-registry";

  export let children: Array<{
    name: string;
    config?: Record<string, unknown>;
  }> = [];
  export let gap: number = 16;
  export let columns: string | undefined = undefined;

  $: gridTemplateColumns =
    columns ?? `repeat(${Math.max(1, children.length)}, minmax(0, 1fr))`;
</script>

<div
  data-columns
  style="display: grid; grid-template-columns: {gridTemplateColumns}; gap: {gap}px; min-width: 0;"
>
  {#each children as child, i (i + ":" + child.name)}
    {@const entry = getMarkdownComponent(child.name)}
    <div data-columns-cell data-child-name={child.name} style="min-width: 0;">
      {#if entry}
        <svelte:component
          this={entry.component as Component}
          {...child.config ?? {}}
        />
      {:else}
        <div
          data-columns-unknown
          style="border: 1px dashed #666; border-radius: 4px; padding: 8px; font-family: monospace; font-size: 11px; color: #888;"
        >
          Unknown widget: gnar:{child.name}
        </div>
      {/if}
    </div>
  {/each}
</div>
