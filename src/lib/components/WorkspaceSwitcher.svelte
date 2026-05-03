<script lang="ts">
  import { tick } from "svelte";
  import { theme } from "../stores/theme";
  import {
    nestedWorkspaces,
    activeNestedWorkspaceIdx,
  } from "../stores/nested-workspace";
  import { workspacesStore } from "../stores/workspaces";
  import { switchNestedWorkspace } from "../services/nested-workspace-service";
  import {
    filterWorkspaces,
    type SwitcherRow,
  } from "../services/workspace-switcher-filter";
  import { isMac } from "../terminal-service";

  export let open: boolean = false;

  let query = "";
  let selectedIdx = 0;
  let inputEl: HTMLInputElement;
  let panelEl: HTMLDivElement;

  $: parentMap = new Map($workspacesStore.map((w) => [w.id, w]));

  $: rows = filterWorkspaces(
    $nestedWorkspaces,
    parentMap,
    query,
    $workspacesStore,
  );

  // All rows are keyboard-navigable; Enter dispatches to the right activate fn based on kind
  $: selectableRows = rows;

  // Clamp selectedIdx when rows shrink
  $: if (selectedIdx >= selectableRows.length) {
    selectedIdx = Math.max(0, selectableRows.length - 1);
  }

  // Reset state each time the switcher opens
  $: if (open) {
    query = "";
    selectedIdx = 0;
    void tick().then(() => inputEl?.focus());
  }

  function close() {
    open = false;
  }

  function activateNested(row: SwitcherRow) {
    switchNestedWorkspace(row.idx);
    close();
  }

  function activateUmbrella(row: SwitcherRow) {
    // Navigate to the umbrella's last-active nested workspace if available
    const umbrellaId = row.wsId;
    if (!umbrellaId) return;
    const umbrella = $workspacesStore.find((w) => w.id === umbrellaId);
    const targetId = umbrella?.lastActiveNestedWorkspaceId;
    const idx = targetId
      ? $nestedWorkspaces.findIndex((ws) => ws.id === targetId)
      : $nestedWorkspaces.findIndex(
          (ws) => ws.metadata?.parentWorkspaceId === umbrellaId,
        );
    if (idx >= 0) {
      switchNestedWorkspace(idx);
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, selectableRows.length - 1);
      scrollSelectedIntoView();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      scrollSelectedIntoView();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = selectableRows[selectedIdx];
      if (row?.kind === "umbrella") activateUmbrella(row);
      else if (row) activateNested(row);
      return;
    }
  }

  function handleInput() {
    selectedIdx = 0;
  }

  function scrollSelectedIntoView() {
    void tick().then(() => {
      const el = panelEl?.querySelector("[data-selected='true']");
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  // Focus-trap: keep focus inside when tabbing
  function handlePanelKeydown(e: KeyboardEvent) {
    if (e.key === "Tab") {
      e.preventDefault();
      inputEl?.focus();
    }
  }

  function handleBackdropMousedown(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  // Map from nested row to its index in selectableRows (for isSelected check)
  function getSelectableIdx(row: SwitcherRow): number {
    return selectableRows.indexOf(row);
  }

  const shortcutLabel = isMac ? "⌘O" : "Ctrl+O";
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    style="
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(0,0,0,0.45);
      display: flex; justify-content: center; align-items: flex-start;
      padding-top: 80px;
    "
    on:mousedown={handleBackdropMousedown}
    on:keydown={handleKeydown}
    tabindex="-1"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Switch Workspace"
      tabindex="-1"
      bind:this={panelEl}
      on:keydown={handlePanelKeydown}
      style="
        width: 480px; max-height: 60vh;
        background: {$theme.bgFloat};
        border: 1px solid {$theme.border};
        border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        display: flex; flex-direction: column;
        overflow: hidden;
      "
    >
      <!-- Input row -->
      <div
        style="
          padding: 10px 12px;
          border-bottom: 1px solid {$theme.border};
          display: flex; align-items: center; gap: 8px;
        "
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          style="flex-shrink: 0; color: {$theme.fgMuted};"
        >
          <circle
            cx="6.5"
            cy="6.5"
            r="4.5"
            stroke="currentColor"
            stroke-width="1.5"
          />
          <line
            x1="10"
            y1="10"
            x2="14"
            y2="14"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        <input
          bind:this={inputEl}
          bind:value={query}
          on:input={handleInput}
          placeholder="Switch workspace…"
          autocomplete="off"
          spellcheck={false}
          class="no-default-outline"
          style="
            flex: 1; background: transparent; border: none;
            color: {$theme.fg}; font-size: 14px;
            font-family: inherit;
          "
        />
        <kbd
          style="
            font-size: 11px; color: {$theme.fgMuted};
            background: {$theme.bg}; border: 1px solid {$theme.border};
            border-radius: 4px; padding: 1px 5px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          "
        >
          {shortcutLabel}
        </kbd>
      </div>

      <!-- Results list -->
      <div
        style="flex: 1; overflow-y: auto; min-height: 0;"
        role="listbox"
        aria-label="Workspace list"
      >
        {#if rows.length === 0}
          <div
            style="
              padding: 24px 16px; text-align: center;
              color: {$theme.fgMuted}; font-size: 13px;
            "
          >
            No workspaces match "{query}"
          </div>
        {:else}
          {#each rows as row (row.ws.id + row.kind)}
            {#if row.kind === "umbrella"}
              {@const uIdx = getSelectableIdx(row)}
              {@const isSelected = uIdx === selectedIdx}
              <!-- Umbrella section header -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_interactive_supports_focus -->
              <div
                role="button"
                data-selected={isSelected}
                on:mousedown={() => activateUmbrella(row)}
                on:mousemove={() => (selectedIdx = uIdx)}
                style="
                  padding: 6px 14px 4px;
                  font-size: 11px;
                  font-weight: 700;
                  letter-spacing: 0.06em;
                  text-transform: uppercase;
                  color: {isSelected ? $theme.fg : $theme.fgMuted};
                  background: {isSelected ? $theme.bgHighlight : 'transparent'};
                  cursor: pointer;
                  user-select: none;
                "
              >
                {row.ws.name}
              </div>
            {:else}
              {@const sIdx = getSelectableIdx(row)}
              {@const isActive = row.idx === $activeNestedWorkspaceIdx}
              {@const isSelected = sIdx === selectedIdx}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_interactive_supports_focus -->
              <div
                role="option"
                aria-selected={isSelected}
                data-selected={isSelected}
                on:mousedown={() => activateNested(row)}
                on:mousemove={() => (selectedIdx = sIdx)}
                style="
                  display: flex; align-items: center; gap: 10px;
                  padding: 9px 14px;
                  padding-left: {row.depth === 1 ? 30 : 14}px;
                  background: {isSelected ? $theme.bgHighlight : 'transparent'};
                  cursor: pointer;
                  border-bottom: 1px solid {$theme.border};
                  transition: background 80ms;
                "
              >
                <!-- Workspace name -->
                <span
                  style="
                    flex: 1; min-width: 0;
                    color: {$theme.fg}; font-size: 13px;
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                  "
                >
                  {row.ws.name}
                </span>

                <!-- Parent workspace label (flat mode only — depth=0 nested rows) -->
                {#if row.parentLabel && row.depth === 0}
                  <span
                    style="
                      font-size: 11px; color: {$theme.fgMuted};
                      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                      max-width: 140px; flex-shrink: 0;
                    "
                  >
                    {row.parentLabel}
                  </span>
                {/if}

                <!-- Active badge -->
                {#if isActive}
                  <span
                    style="
                      font-size: 10px; font-weight: 600;
                      color: {$theme.success};
                      background: {$theme.success}22;
                      border: 1px solid {$theme.success}66;
                      border-radius: 4px; padding: 1px 6px;
                      flex-shrink: 0; text-transform: uppercase;
                      letter-spacing: 0.04em;
                    "
                  >
                    active
                  </span>
                {/if}
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
