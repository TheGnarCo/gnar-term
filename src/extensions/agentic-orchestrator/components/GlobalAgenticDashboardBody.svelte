<script lang="ts">
  /**
   * Body for the Global Agentic Dashboard pseudo-workspace — renders
   * the configured markdown (default `~/.config/gnar-term/global-agents.md`)
   * in a detached preview pipeline and registers a synthetic
   * preview-surface entry so the markdown previewer's closest-lookup
   * injects the global DashboardHostContext into embedded widgets.
   *
   * Setting the host context via `setDashboardHost` covers in-tree Svelte
   * consumers; the preview-surface registry entry covers the detached
   * `mount()` tree that the markdown previewer uses when instantiating
   * `gnar:*` widgets.
   */
  import { onDestroy, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { setDashboardHost } from "../../../lib/contexts/dashboard-host";
  import {
    registerPreviewSurface,
    unregisterPreviewSurface,
  } from "../../../lib/services/preview-surface-registry";
  import {
    openPreview,
    type PreviewResult,
  } from "../../../lib/services/preview-service";
  import { getConfig } from "../../../lib/config";

  /** Default Global Agentic Dashboard template — widgets derive scope
   *  from the enclosing DashboardHostContext. */
  const DEFAULT_TEMPLATE = `# Global Agents

Every detected agent in gnar-term.

\`\`\`gnar:kanban
\`\`\`

\`\`\`gnar:agent-list
title: Active Agents
\`\`\`
`;

  const hostMetadata = { isGlobalAgenticDashboard: true };
  const surfaceId = `pseudo.agentic.global:${Math.random().toString(36).slice(2, 8)}`;

  // Svelte-context path — covers children rendered inside this tree
  // (e.g. if we later mount non-markdown-previewer widgets directly).
  setDashboardHost({ metadata: hostMetadata });

  let container: HTMLElement;
  let loadError: string | null = null;
  let result: PreviewResult | null = null;

  async function ensureMarkdownPath(): Promise<string> {
    const configured = getConfig().agenticGlobal?.markdownPath?.trim();
    const home = await invoke<string>("get_home").catch(() => "");
    const defaultRoot = home
      ? `${home}/.config/gnar-term`
      : ".config/gnar-term";
    const defaultPath = `${defaultRoot}/global-agents.md`;
    const path = configured && configured.length > 0 ? configured : defaultPath;
    const exists = await invoke<boolean>("file_exists", { path }).catch(
      () => false,
    );
    if (!exists) {
      const dir = path.replace(/\/[^/]+$/, "");
      await invoke("ensure_dir", { path: dir }).catch(() => {});
      await invoke("write_file", {
        path,
        content: DEFAULT_TEMPLATE,
      }).catch(() => {});
    }
    return path;
  }

  onMount(async () => {
    try {
      const markdownPath = await ensureMarkdownPath();
      registerPreviewSurface({
        surfaceId,
        path: markdownPath,
        paneId: "",
        workspaceId: "",
        hostMetadata,
      });
      result = await openPreview(markdownPath);
      container.appendChild(result.element);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  });

  onDestroy(() => {
    result?.dispose?.();
    if (result?.watchId && result.watchId > 0) {
      invoke("unwatch_file", { watchId: result.watchId }).catch(() => {});
    }
    unregisterPreviewSurface(surfaceId);
  });
</script>

<div
  bind:this={container}
  data-preview-surface-id={surfaceId}
  data-global-agentic-dashboard
  style="flex: 1; min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column;"
>
  {#if loadError}
    <div
      data-global-agentic-dashboard-error
      style="padding: 16px; font-family: monospace; font-size: 13px;"
    >
      {loadError}
    </div>
  {/if}
</div>
