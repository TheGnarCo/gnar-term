<script lang="ts">
  import { tick } from "svelte";
  import { theme } from "../stores/theme";
  import { findBarVisible } from "../stores/ui";
  import { activeSurface } from "../stores/nested-workspace";
  import { isTerminalSurface } from "../types";

  let inputEl: HTMLInputElement;
  let query = "";
  let regexEnabled = false;
  let caseSensitive = false;
  let wholeWord = false;

  function getSearchAddon() {
    const s = $activeSurface;
    if (!s || !isTerminalSurface(s)) return null;
    return s.searchAddon;
  }

  function doSearch(direction: "next" | "prev") {
    const addon = getSearchAddon();
    if (!addon || !query) return;
    const opts = { regex: regexEnabled, caseSensitive, wholeWord };
    if (direction === "next") addon.findNext(query, opts);
    else addon.findPrevious(query, opts);
  }

  function toggleRegex() {
    regexEnabled = !regexEnabled;
    doSearch("next");
  }

  function toggleCase() {
    caseSensitive = !caseSensitive;
    doSearch("next");
  }

  function toggleWord() {
    wholeWord = !wholeWord;
    doSearch("next");
  }

  function close() {
    const addon = getSearchAddon();
    if (addon) addon.clearDecorations();
    findBarVisible.set(false);
    regexEnabled = false;
    caseSensitive = false;
    wholeWord = false;
    const s = $activeSurface;
    if (s && isTerminalSurface(s)) s.terminal.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch(e.shiftKey ? "prev" : "next");
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  export function focusInput() {
    inputEl?.focus();
    inputEl?.select();
  }

  export function findNext() {
    doSearch("next");
  }
  export function findPrev() {
    doSearch("prev");
  }

  $: if ($findBarVisible && inputEl) {
    void tick().then(() => {
      inputEl?.focus();
      inputEl?.select();
    });
  }
</script>

{#if $findBarVisible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    id="find-bar"
    style="
      position: absolute; top: 8px; right: 16px; z-index: 1000;
      display: flex; align-items: center; gap: 4px;
      background: {$theme.bgFloat}; border: 1px solid {$theme.border};
      border-radius: 6px; padding: 4px 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-size: 13px; color: {$theme.fg};
    "
    on:keydown={handleKeydown}
  >
    <input
      bind:this={inputEl}
      type="text"
      placeholder="Find..."
      bind:value={query}
      on:input={() => doSearch("next")}
      class="no-default-outline"
      style="
        background: {$theme.bg}; border: 1px solid {$theme.border};
        border-radius: 4px; padding: 3px 8px; color: {$theme.fg};
        font-size: 13px; font-family: inherit; width: 200px;
      "
    />
    <button
      title="Previous match (⇧⌘G)"
      aria-label="Previous match (⇧⌘G)"
      on:click={() => doSearch("prev")}
      style="background: none; border: none; color: {$theme.fgMuted}; cursor: pointer; padding: 2px 4px; border-radius: 3px; display: flex; align-items: center;"
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="2"><polyline points="12,10 8,6 4,10" /></svg
      >
    </button>
    <button
      title="Next match (⌘G)"
      aria-label="Next match (⌘G)"
      on:click={() => doSearch("next")}
      style="background: none; border: none; color: {$theme.fgMuted}; cursor: pointer; padding: 2px 4px; border-radius: 3px; display: flex; align-items: center;"
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="2"><polyline points="4,6 8,10 12,6" /></svg
      >
    </button>
    <button
      title="Use regular expression"
      aria-label="Use regular expression"
      aria-pressed={regexEnabled}
      on:click={toggleRegex}
      style="background: {regexEnabled
        ? $theme.bg
        : 'none'}; border: {regexEnabled
        ? `1px solid ${$theme.border}`
        : 'none'}; color: {regexEnabled
        ? $theme.fg
        : $theme.fgMuted}; cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 12px; font-family: monospace; line-height: 1;"
      >.*</button
    >
    <button
      title="Match case"
      aria-label="Match case"
      aria-pressed={caseSensitive}
      on:click={toggleCase}
      style="background: {caseSensitive
        ? $theme.bg
        : 'none'}; border: {caseSensitive
        ? `1px solid ${$theme.border}`
        : 'none'}; color: {caseSensitive
        ? $theme.fg
        : $theme.fgMuted}; cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 12px; font-family: monospace; line-height: 1;"
      >Aa</button
    >
    <button
      title="Match whole word"
      aria-label="Match whole word"
      aria-pressed={wholeWord}
      on:click={toggleWord}
      style="background: {wholeWord ? $theme.bg : 'none'}; border: {wholeWord
        ? `1px solid ${$theme.border}`
        : 'none'}; color: {wholeWord
        ? $theme.fg
        : $theme.fgMuted}; cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 12px; font-family: monospace; line-height: 1;"
      >[W]</button
    >
    <button
      title="Close (Esc)"
      aria-label="Close (Esc)"
      on:click={close}
      style="background: none; border: none; color: {$theme.fgMuted}; cursor: pointer; padding: 2px 4px; border-radius: 3px; display: flex; align-items: center;"
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        ><line x1="4" y1="4" x2="12" y2="12" /><line
          x1="12"
          y1="4"
          x2="4"
          y2="12"
        /></svg
      >
    </button>
  </div>
{/if}
