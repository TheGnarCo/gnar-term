<script lang="ts">
  import { theme } from "../stores/theme";
  import {
    runDefinedCommand,
    dismissDefinedCommand,
    waitForPtyReady,
  } from "../terminal-service";
  import type { TerminalSurface } from "../types";

  export let surface: TerminalSurface;

  async function reRun(): Promise<void> {
    try {
      await waitForPtyReady(surface);
    } catch {
      dismissDefinedCommand(surface);
      return;
    }
    await runDefinedCommand(surface);
  }

  function dismiss(): void {
    dismissDefinedCommand(surface);
  }
</script>

{#if surface.pendingRestoreCommand && surface.definedCommand}
  <div
    role="status"
    style="
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px;
      background: {$theme.bgFloat};
      border-bottom: 1px solid {$theme.notify};
      box-shadow: inset 0 -1px 0 {$theme.notifyGlow};
      color: {$theme.fg};
      font-size: 12px;
      flex: 0 0 auto;
    "
  >
    <span style="color: {$theme.fgMuted};">Last session ran</span>
    <code
      style="
        flex: 1; min-width: 0; color: {$theme.fg};
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      "
      title={surface.definedCommand}
    >
      {surface.definedCommand}
    </code>
    <button
      type="button"
      on:click={reRun}
      style="
        padding: 3px 10px; border-radius: 4px; border: none;
        background: {$theme.notify}; color: white;
        cursor: pointer; font-size: 12px;
      "
    >
      Re-run
    </button>
    <button
      type="button"
      on:click={dismiss}
      style="
        padding: 3px 10px; border-radius: 4px;
        border: 1px solid {$theme.border};
        background: transparent; color: {$theme.fgMuted};
        cursor: pointer; font-size: 12px;
      "
    >
      Dismiss
    </button>
  </div>
{/if}
