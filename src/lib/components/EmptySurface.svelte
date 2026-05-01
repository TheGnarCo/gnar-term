<script lang="ts">
  /**
   * EmptySurface — shown in the terminal area when no workspace is open,
   * or when the current workspace's active pane has zero surfaces (the
   * user just closed the last one). Provides quick actions plus a
   * launcher into existing projects and nestedWorkspaces.
   *
   * Buttons are sourced from:
   *   - `workspaceActionStore` (core + extension non-sidebar actions
   *     whose `when` filter accepts an empty context)
   *   - `commandStore` entries registered with the ids listed in
   *     `empty-surface-commands.ts` (e.g. workspace-groups:create-workspace-group)
   *
   * The "Jump to existing" list pulls from `rootRowOrder` so projects +
   * workspace rows render in the same order the sidebar shows them.
   */
  import { get } from "svelte/store";
  import { theme } from "../stores/theme";
  import { workspaceActionStore } from "../services/workspace-action-registry";
  import { commandStore } from "../services/command-registry";
  import { EMPTY_SURFACE_COMMAND_IDS } from "../services/empty-surface-commands";
  import {
    nestedWorkspaces,
    activeNestedWorkspaceIdx,
  } from "../stores/nested-workspace";
  import { rootRowOrder } from "../stores/root-row-order";
  import { rootRowRendererStore } from "../services/root-row-renderer-registry";
  import { switchNestedWorkspace } from "../services/nested-workspace-service";
  import { newSurface } from "../services/surface-service";
  import { wsMeta } from "../services/service-helpers";

  const iconSvgMap: Record<string, string> = {
    plus: `<line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />`,
    "git-branch": `<line x1="7" y1="2" x2="7" y2="10" /><line x1="3" y1="6" x2="11" y2="6" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><path d="M7 10 C7 12 10 12 12 12" fill="none" />`,
    "folder-plus": `<path d="M2 4 L2 13 L14 13 L14 6 L8 6 L7 4 Z" fill="none" /><line x1="8" y1="8" x2="8" y2="12" /><line x1="6" y1="10" x2="10" y2="10" />`,
  };

  $: workspaceActions = $workspaceActionStore.filter(
    (a) => a.zone !== "sidebar" && (!a.when || a.when({})),
  );

  // Commands to promote as buttons. Filter to those actually registered.
  $: promotedCommands = EMPTY_SURFACE_COMMAND_IDS.map((id) =>
    $commandStore.find((c) => c.id === id),
  ).filter((c): c is NonNullable<typeof c> => !!c);

  interface Button {
    label: string;
    icon: string;
    run: () => void;
  }

  // Dashboard-regen lives in PaneView's dashboard header strip, not here.

  $: buttons = [
    ...workspaceActions.map(
      (a): Button => ({
        label: a.label,
        icon: a.icon,
        run: () => void a.handler({}),
      }),
    ),
    ...promotedCommands.map(
      (c): Button => ({
        label: c.title.replace(/\.\.\.$/, ""),
        icon: "folder-plus",
        run: () => void c.action(),
      }),
    ),
  ];

  // --- Existing nestedWorkspaces / projects / dashboards ---
  //
  // When the current empty pane lives inside a workspace, clicking its
  // own entry should spawn a terminal in the pane rather than switch
  // to itself (a no-op would feel broken). Every other click routes
  // to switchNestedWorkspace / the row's renderer label for context.
  $: currentWs = $nestedWorkspaces[$activeNestedWorkspaceIdx];
  function activateWorkspaceAt(idx: number) {
    if (idx === $activeNestedWorkspaceIdx && currentWs) {
      // The click-target IS the current empty workspace — start a new
      // terminal surface in its active pane so the user transitions
      // from "empty" to "usable" without leaving context.
      const paneId = currentWs.activePaneId;
      if (paneId) {
        void newSurface(paneId);
      }
      return;
    }
    switchNestedWorkspace(idx);
  }

  // Build a "jump list" modeled after the sidebar rootRowOrder. Project
  // rows render as a header (click = switch to that project's first
  // workspace); nested nestedWorkspaces fan out below. Standalone nestedWorkspaces
  // render as leaf entries. Non-workspace/project rows (e.g. agent
  // dashboards) are rendered through their label resolver so they show
  // something, but lack an activation handler beyond switchNestedWorkspace —
  // dashboards open as preview surfaces via their own row click, not
  // through this launcher.
  interface JumpRow {
    kind: "workspace";
    workspaceId: string;
    idx: number;
    label: string;
    badge?: string;
  }

  $: jumpRows = (() => {
    const list = get(nestedWorkspaces);
    const out: JumpRow[] = [];
    const seen = new Set<string>();
    for (const row of $rootRowOrder) {
      if (row.kind === "nested-workspace") {
        const idx = list.findIndex((w) => w.id === row.id);
        if (idx < 0) continue;
        const ws = list[idx]!;
        out.push({
          kind: "workspace",
          workspaceId: ws.id,
          idx,
          label: ws.name,
        });
        seen.add(ws.id);
        continue;
      }
      // Non-nested-workspace row kinds (workspace, agent-orchestrator…).
      // Use their renderer-contributed label as a visual header, then
      // fan out any nestedWorkspaces tagged with the row's parentWorkspaceId.
      const rendererMeta = $rootRowRendererStore.find((r) => r.id === row.kind);
      const headerLabel = rendererMeta?.label?.(row.id);
      if (headerLabel && row.kind === "workspace") {
        for (let i = 0; i < list.length; i++) {
          const ws = list[i]!;
          if (seen.has(ws.id)) continue;
          if (wsMeta(ws).parentWorkspaceId === row.id) {
            out.push({
              kind: "workspace",
              workspaceId: ws.id,
              idx: i,
              label: ws.name,
              badge: headerLabel,
            });
            seen.add(ws.id);
          }
        }
      }
    }
    // Fallback pass — any nestedWorkspaces not yet rendered (e.g. tagged to
    // a project whose root row isn't in the order). Keeps the launcher
    // exhaustive rather than silently hiding entries.
    for (let i = 0; i < list.length; i++) {
      const ws = list[i]!;
      if (seen.has(ws.id)) continue;
      out.push({
        kind: "workspace",
        workspaceId: ws.id,
        idx: i,
        label: ws.name,
      });
      seen.add(ws.id);
    }
    return out;
  })();
</script>

<div
  style="
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: {$theme.bg};
    overflow: auto;
  "
>
  <div
    style="
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 32px;
      max-width: 520px;
    "
  >
    <div
      style="
        font-size: 13px;
        color: {$theme.fgMuted};
        text-align: center;
        line-height: 1.5;
      "
    >
      {#if currentWs}
        No surfaces in <strong style="color: {$theme.fg};"
          >{currentWs.name}</strong
        >. Start something new, or jump to another workspace.
      {:else}
        No nestedWorkspaces are open. Create one to get started.
      {/if}
    </div>
    {#if buttons.length > 0}
      <div
        style="
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
        "
      >
        {#each buttons as btn (btn.label)}
          <button
            type="button"
            on:click={btn.run}
            style="
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 8px 14px;
              border: 1px solid {$theme.border};
              background: {$theme.bgSurface};
              color: {$theme.fg};
              border-radius: 6px;
              font-size: 13px;
              font-family: inherit;
              cursor: pointer;
              transition: background 0.1s, border-color 0.1s;
            "
            on:mouseenter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                $theme.borderActive ?? $theme.accent;
            }}
            on:mouseleave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                $theme.border;
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              {@html iconSvgMap[btn.icon] ?? iconSvgMap.plus}
            </svg>
            {btn.label}
          </button>
        {/each}
      </div>
    {/if}

    {#if jumpRows.length > 0}
      <div
        style="
          display: flex; flex-direction: column; gap: 6px;
          width: 100%; max-width: 420px;
          margin-top: 4px;
        "
      >
        <div
          style="
            font-size: 11px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 0.5px; color: {$theme.fgDim}; text-align: left;
          "
        >
          Jump to workspace
        </div>
        {#each jumpRows as row (row.workspaceId)}
          <button
            type="button"
            on:click={() => activateWorkspaceAt(row.idx)}
            style="
              display: flex; align-items: center; gap: 8px;
              padding: 8px 12px;
              border: 1px solid {row.idx === $activeNestedWorkspaceIdx
              ? ($theme.borderActive ?? $theme.accent)
              : $theme.border};
              background: {row.idx === $activeNestedWorkspaceIdx
              ? $theme.bgHighlight
              : $theme.bgSurface};
              color: {$theme.fg};
              border-radius: 6px;
              font-size: 13px; font-family: inherit; cursor: pointer;
              text-align: left;
            "
          >
            <span style="flex: 1; min-width: 0;">{row.label}</span>
            {#if row.badge}
              <span
                style="
                  font-size: 10px; color: {$theme.fgDim};
                  padding: 1px 6px; border-radius: 8px;
                  background: {$theme.bgHighlight};
                  white-space: nowrap;
                "
              >
                {row.badge}
              </span>
            {/if}
            {#if row.idx === $activeNestedWorkspaceIdx}
              <span style="font-size: 10px; color: {$theme.fgDim};">
                current — starts a new terminal
              </span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
