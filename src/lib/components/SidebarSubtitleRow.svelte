<script lang="ts">
  /**
   * SidebarSubtitleRow — a thin, ellipsizing subtitle line below a
   * sidebar row's title (unread counts, notifications, meta). Ported
   * verbatim from dev: a presentational wrapper with no behavior.
   */
  /** Foreground text color for the row. */
  export let color: string;
  /** CSS padding shorthand. Defaults match the subtitle rows. */
  export let padding: string = "0 0 0 2px";
  /** Font size in pixels. Defaults to 11; pass 10 for compact status rows. */
  export let fontSize: number = 11;
  /** Optional opacity (e.g. 0.85 for status badges). */
  export let opacity: number | undefined = undefined;
</script>

<div
  {...$$restProps}
  style="padding: {padding}; font-size: {fontSize}px; color: {color}; display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;{opacity !==
  undefined
    ? ` opacity: ${opacity};`
    : ''}"
>
  <slot />
</div>
