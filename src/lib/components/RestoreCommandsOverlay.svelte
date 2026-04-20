<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { theme } from "../stores/theme";
  import { workspaces } from "../stores/workspace";
  import {
    getAllPanes,
    isTerminalSurface,
    type TerminalSurface,
  } from "../types";
  import {
    runDefinedCommand,
    dismissDefinedCommand,
    waitForPtyReady,
  } from "../terminal-service";

  export let onClose: () => void;

  interface Row {
    workspaceName: string;
    paneId: string;
    surface: TerminalSurface;
    command: string;
    checked: boolean;
  }

  let rows: Row[] = [];

  function collectRows(): Row[] {
    const out: Row[] = [];
    for (const ws of get(workspaces)) {
      for (const pane of getAllPanes(ws.splitRoot)) {
        for (const s of pane.surfaces) {
          if (
            isTerminalSurface(s) &&
            s.pendingRestoreCommand &&
            s.definedCommand
          ) {
            out.push({
              workspaceName: ws.name,
              paneId: pane.id,
              surface: s,
              command: s.definedCommand,
              checked: true,
            });
          }
        }
      }
    }
    return out;
  }

  // Re-runs only fire after the PTY is ready — restore happens before any
  // TerminalSurface mounts, so the surface.ptyId is still -1 at this point.
  async function runIfReady(s: TerminalSurface): Promise<void> {
    try {
      await waitForPtyReady(s);
    } catch {
      // PTY never came up — fall back to dismiss so the banner doesn't
      // linger forever on a dead surface.
      dismissDefinedCommand(s);
      return;
    }
    await runDefinedCommand(s);
  }

  function close(): void {
    onClose();
  }

  function restoreSelected(): void {
    for (const row of rows) {
      if (row.checked) {
        void runIfReady(row.surface);
      } else {
        dismissDefinedCommand(row.surface);
      }
    }
    close();
  }

  function restoreAll(): void {
    for (const row of rows) {
      void runIfReady(row.surface);
    }
    close();
  }

  function skipAll(): void {
    for (const row of rows) {
      dismissDefinedCommand(row.surface);
    }
    close();
  }

  function handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      skipAll();
    }
  }

  onMount(() => {
    rows = collectRows();
    if (rows.length === 0) close();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  style="
    position: fixed; inset: 0; z-index: 10001;
    background: rgba(0,0,0,0.5); display: flex;
    justify-content: center; align-items: flex-start; padding-top: 80px;
  "
  on:mousedown|self={skipAll}
  on:keydown={handleKeydown}
  tabindex="-1"
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="restore-commands-title"
    style="
      width: 560px; max-height: 70vh; background: {$theme.bgFloat};
      border: 1px solid {$theme.border}; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
      padding: 18px; display: flex; flex-direction: column; gap: 12px;
      overflow: hidden;
    "
  >
    <div>
      <h2
        id="restore-commands-title"
        style="
          margin: 0; color: {$theme.fg}; font-size: 16px; font-weight: 600;
        "
      >
        Restore commands from last session
      </h2>
      <p
        style="
          margin: 4px 0 0; color: {$theme.fgMuted}; font-size: 13px;
        "
      >
        {rows.length} pane{rows.length === 1 ? "" : "s"} had commands running before
        quit. Choose which to re-run.
      </p>
    </div>

    <div
      style="
        flex: 1; overflow-y: auto; min-height: 0;
        border: 1px solid {$theme.border}; border-radius: 8px;
        background: {$theme.bg};
      "
    >
      {#each rows as row, i (row.surface.id)}
        <label
          style="
            display: flex; align-items: center; gap: 10px;
            padding: 10px 12px;
            border-bottom: {i < rows.length - 1
            ? `1px solid ${$theme.border}`
            : 'none'};
            cursor: pointer;
          "
        >
          <input
            type="checkbox"
            bind:checked={row.checked}
            data-testid="restore-row-checkbox"
          />
          <span style="color: {$theme.fgMuted}; font-size: 12px; min-width: 0;">
            {row.workspaceName}
          </span>
          <code
            style="
              flex: 1; min-width: 0; color: {$theme.fg};
              font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
              font-size: 12px;
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            "
            title={row.command}
          >
            {row.command}
          </code>
        </label>
      {/each}
    </div>

    <div style="display: flex; justify-content: flex-end; gap: 8px;">
      <button
        type="button"
        on:click={skipAll}
        style="
          padding: 6px 16px; border-radius: 6px;
          border: 1px solid {$theme.border};
          background: transparent; color: {$theme.fgMuted};
          cursor: pointer; font-size: 13px;
        "
      >
        Skip all
      </button>
      <button
        type="button"
        on:click={restoreAll}
        style="
          padding: 6px 16px; border-radius: 6px;
          border: 1px solid {$theme.border};
          background: transparent; color: {$theme.fg};
          cursor: pointer; font-size: 13px;
        "
      >
        Restore all
      </button>
      <button
        type="button"
        on:click={restoreSelected}
        style="
          padding: 6px 16px; border-radius: 6px; border: none;
          background: {$theme.notify}; color: white;
          cursor: pointer; font-size: 13px; font-weight: 500;
        "
      >
        Restore selected
      </button>
    </div>
  </div>
</div>
