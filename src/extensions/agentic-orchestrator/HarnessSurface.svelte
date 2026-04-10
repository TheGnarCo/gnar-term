<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import {
    createStatusTracker,
    type HarnessStatus,
    type StatusTracker,
  } from "./status-tracker";

  /** Props passed via api.openSurface(). */
  export let command: string = "";
  export let cwd: string = "";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  let status: HarnessStatus = "idle";
  let tracker: StatusTracker | undefined;

  const STATUS_COLORS: Record<HarnessStatus, string> = {
    running: "#4ec957",
    waiting: "#e8b73a",
    idle: "#888888",
  };

  const STATUS_LABELS: Record<HarnessStatus, string> = {
    running: "Running",
    waiting: "Waiting",
    idle: "Idle",
  };

  function handleStatusChange(next: HarnessStatus): void {
    status = next;
    api.emit("extension:harness:statusChanged", {
      status: next,
      command,
      cwd,
    });
  }

  onMount(() => {
    const idleTimeoutSec = api.getSetting<number>("idleTimeout") ?? 30;
    tracker = createStatusTracker(idleTimeoutSec * 1000, handleStatusChange);
  });

  onDestroy(() => {
    tracker?.destroy();
  });
</script>

<div
  class="harness-surface"
  style="
    display: flex;
    flex-direction: column;
    height: 100%;
    background: {$theme.bg};
    color: {$theme.fg};
  "
>
  <!-- Status bar -->
  <div
    style="
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      border-bottom: 1px solid {$theme.border};
      font-size: 12px;
      flex-shrink: 0;
    "
  >
    <span
      style="
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: {STATUS_COLORS[status]};
        flex-shrink: 0;
      "
    ></span>
    <span style="font-weight: 500;">{STATUS_LABELS[status]}</span>
    {#if command}
      <span
        style="color: {$theme.fgDim}; margin-left: auto; font-family: monospace; font-size: 11px;"
      >
        {command}
      </span>
    {/if}
  </div>

  <!-- Terminal area placeholder -->
  <!-- Full PTY event stream integration requires Phase 4 wiring.
       The extension API does not currently expose raw Tauri event listeners
       (pty-output, pty-notification, pty-title), which are needed to feed
       xterm.js and drive the status tracker. When that bridge is added,
       this area will host a live Terminal instance. -->
  <div
    style="
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-size: 13px;
      color: {$theme.fgDim};
      text-align: center;
      font-family: monospace;
    "
  >
    <div>
      <div style="margin-bottom: 8px;">Harness surface ready</div>
      {#if command}
        <div style="font-size: 11px;">
          <span style="color: {$theme.fg};">$</span>
          {command}
        </div>
      {/if}
      {#if cwd}
        <div style="font-size: 11px; margin-top: 4px; color: {$theme.fgDim};">
          in {cwd}
        </div>
      {/if}
      <div style="margin-top: 16px; font-size: 11px; opacity: 0.6;">
        PTY integration pending Phase 4
      </div>
    </div>
  </div>
</div>
