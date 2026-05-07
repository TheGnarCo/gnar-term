<script lang="ts">
  import { tick } from "svelte";
  import { theme } from "../stores/theme";

  /** Current value of the label. While editing, this prop is not bound — the
   * parent receives the new value via onCommit and is responsible for updating
   * its source of truth. */
  export let value: string;
  /** Called when the user finishes editing with a non-empty, changed value. */
  export let onCommit: (next: string) => void;
  /** Aria-label for the contentEditable region. */
  export let ariaLabel: string;
  /** Inline style applied to the editable span. */
  export let style: string = "";
  /** CSS class(es) applied to the editable span. */
  export let klass: string = "";

  let labelEl: HTMLSpanElement;
  let editing = false;

  // Saved before edit so the label can be restored to whatever the parent
  // had (e.g. `pointer-events: none` on a banner title) when editing ends.
  let savedPointerEvents = "";
  let savedUserSelect = "";

  export async function startRename(): Promise<void> {
    editing = true;
    await tick();
    if (!labelEl) return;
    savedPointerEvents = labelEl.style.pointerEvents;
    savedUserSelect = labelEl.style.userSelect;
    labelEl.contentEditable = "true";
    labelEl.style.background = $theme.bgSurface;
    labelEl.style.border = `1px solid ${$theme.borderActive}`;
    labelEl.style.pointerEvents = "auto";
    labelEl.style.userSelect = "text";
    labelEl.focus();
    const range = document.createRange();
    range.selectNodeContents(labelEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function finishRename(): void {
    if (!labelEl) return;
    labelEl.contentEditable = "false";
    labelEl.style.background = "transparent";
    labelEl.style.border = "none";
    labelEl.style.pointerEvents = savedPointerEvents;
    labelEl.style.userSelect = savedUserSelect;
    const next = labelEl.textContent?.trim();
    if (next && next !== value) {
      onCommit(next);
    } else {
      labelEl.textContent = value;
    }
    editing = false;
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      labelEl.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      labelEl.textContent = value;
      labelEl.blur();
    }
  }

  // Keep DOM text in sync when the parent's `value` changes outside an edit
  // (e.g. after commit, or when the parent's source of truth shifts).
  $: if (labelEl && !editing) labelEl.textContent = value;
</script>

<span
  bind:this={labelEl}
  role="textbox"
  aria-label={ariaLabel}
  aria-multiline="false"
  tabindex="-1"
  class={klass}
  {style}
  on:blur={finishRename}
  on:keydown={handleKeydown}>{value}</span
>
