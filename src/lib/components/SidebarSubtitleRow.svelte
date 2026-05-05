<script lang="ts">
  /** Foreground text color for the row. */
  export let color: string;
  /** CSS padding shorthand. Defaults match the worktree/subtitle rows. */
  export let padding: string = "0 24px 2px 2px";
  /** Optional opacity (e.g. 0.85 for status badges). */
  export let opacity: number | undefined = undefined;
</script>

<div
  {...$$restProps}
  style="padding: {padding}; font-size: 11px; color: {color}; display: flex; align-items: center; gap: 4px; overflow: hidden;{opacity !==
  undefined
    ? ` opacity: ${opacity};`
    : ''}"
>
  <slot />
</div>
