<script lang="ts" generics="T">
  /**
   * Recursive tree view over `DocTreeNode<T>` lists. Folders are
   * collapsible chevrons; leaves are rendered through the `leaf` snippet
   * prop so callers control the row UI. The snippet is forwarded into
   * `<svelte:self>` because default slots do not propagate across
   * recursive instances. Expansion state is owned by the caller (Set of
   * folder paths) so multiple panes can be controlled independently and
   * the state is preserved across data refreshes.
   */
  import type { Snippet } from "svelte";
  import type { DocTreeNode, DocTreeLeaf } from "./doc-tree";

  export let nodes: DocTreeNode<T>[];
  export let expanded: Set<string>;
  export let onToggle: (path: string) => void;
  export let depth: number = 0;
  export let folderColor: string = "inherit";
  export let chevronColor: string = "inherit";
  export let leaf: Snippet<[{ node: DocTreeLeaf<T>; depth: number }]>;

  // Reactive copy ensures the tree re-renders when `expanded` mutates in
  // place (Svelte equality check on Set instances skips identity-only
  // updates otherwise).
  $: expandedSnapshot = expanded;
</script>

<ul class="doc-tree">
  {#each nodes as node (node.kind + ":" + node.path)}
    {#if node.kind === "folder"}
      {@const open = expandedSnapshot.has(node.path)}
      <li class="folder">
        <button
          type="button"
          class="folder-row"
          style="padding-left: {depth * 12}px; color: {folderColor};"
          on:click={() => onToggle(node.path)}
          aria-expanded={open}
        >
          <svg
            class="chevron"
            class:open
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
            style="color: {chevronColor};"
          >
            <polyline
              points="3,1 7,5 3,9"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="folder-name">{node.name}</span>
        </button>
        {#if open}
          <svelte:self
            nodes={node.children}
            {expanded}
            {onToggle}
            depth={depth + 1}
            {folderColor}
            {chevronColor}
            {leaf}
          />
        {/if}
      </li>
    {:else}
      <li class="leaf" style="padding-left: {depth * 12 + 16}px;">
        {@render leaf({ node, depth })}
      </li>
    {/if}
  {/each}
</ul>

<style>
  .doc-tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .folder-row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    background: none;
    border: 0;
    padding: 3px 4px 3px 0;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .folder-row:hover .folder-name {
    text-decoration: underline;
  }
  .chevron {
    flex-shrink: 0;
    transition: transform 0.12s ease-out;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .folder-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .leaf {
    margin: 1px 0;
  }
</style>
