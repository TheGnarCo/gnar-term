<script lang="ts">
  import { tick } from "svelte";
  import { theme } from "../stores/theme";
  import { commandPaletteOpen } from "../stores/ui";
  import { activeSurface } from "../stores/workspace";
  import { isTerminalSurface } from "../types";
  import { commandStore, type Command } from "../services/command-registry";

  let inputEl: HTMLInputElement;
  let query = "";
  let selectedIdx = 0;

  $: allCommands = $commandStore;
  $: filtered = query
    ? allCommands.filter((c) =>
        c.title.toLowerCase().includes(query.toLowerCase()),
      )
    : allCommands;

  $: if (filtered.length > 0 && selectedIdx >= filtered.length) {
    selectedIdx = 0;
  }

  function close() {
    commandPaletteOpen.set(false);
    query = "";
    selectedIdx = 0;
    const s = $activeSurface;
    if (s && isTerminalSurface(s)) void tick().then(() => s.terminal.focus());
  }

  function execute(cmd: Command) {
    close();
    void cmd.action();
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      return;
    }
    if (e.key === "Enter" && filtered[selectedIdx]) {
      execute(filtered[selectedIdx]!);
      return;
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement)?.id === "cmd-palette-overlay") close();
  }

  $: if ($commandPaletteOpen) {
    void tick().then(() => inputEl?.focus());
  }
</script>

{#if $commandPaletteOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    id="cmd-palette-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Command palette"
    tabindex="-1"
    style="
      position: fixed; inset: 0; z-index: 9998;
      background: rgba(0,0,0,0.5); display: flex;
      justify-content: center; padding-top: 80px;
    "
    on:mousedown={handleOverlayClick}
    on:keydown={handleKeydown}
  >
    <div
      style="
      width: 500px; max-height: 400px; background: {$theme.bgFloat};
      border: 1px solid {$theme.border}; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
      display: flex; flex-direction: column; overflow: hidden;
    "
    >
      <input
        bind:this={inputEl}
        type="text"
        placeholder="Type a command..."
        aria-label="Command search"
        aria-autocomplete="list"
        aria-controls="cmd-palette-listbox"
        aria-activedescendant={filtered.length
          ? `cmd-option-${selectedIdx}`
          : undefined}
        bind:value={query}
        on:input={() => {
          selectedIdx = 0;
        }}
        style="
          padding: 14px 18px; background: transparent; border: none;
          border-bottom: 1px solid {$theme.border}; color: {$theme.fg};
          font-size: 15px; outline: none; font-family: inherit;
        "
      />
      <div
        id="cmd-palette-listbox"
        role="listbox"
        aria-label="Commands"
        style="flex: 1; overflow-y: auto; padding: 4px 0;"
      >
        {#each filtered as cmd, i}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            id="cmd-option-{i}"
            role="option"
            tabindex="-1"
            aria-selected={i === selectedIdx}
            style="
              padding: 8px 18px; cursor: pointer; display: flex;
              align-items: center; justify-content: space-between;
              background: {i === selectedIdx
              ? $theme.bgHighlight
              : 'transparent'};
              color: {$theme.fg}; font-size: 13px;
            "
            on:mouseenter={() => (selectedIdx = i)}
            on:click={() => execute(cmd)}
          >
            <span>{cmd.title}</span>
            {#if cmd.shortcut}
              <span style="font-size: 11px; color: {$theme.fgDim};"
                >{cmd.shortcut}</span
              >
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
