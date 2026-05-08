<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { writable, get, derived } from "svelte/store";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import { workspaces } from "../../lib/stores/workspace";
  import { createSpacebaseClient, type DocSummary } from "./api-client";
  import { resolveAuthConfig } from "./auth-store";
  import {
    computeDashboardEntries,
    type DashboardEntry,
  } from "./dashboard-data";
  import { walkMarkdownFiles, type DirEntry } from "./fs-walk";

  export let rootWorkspaceId: string | undefined = undefined;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  const entries = writable<DashboardEntry[]>([]);
  const loading = writable<boolean>(false);
  const error = writable<string | null>(null);

  // Resolve the host workspace's CWD from its id.
  $: workspace = $workspaces.find((w) => w.id === rootWorkspaceId);
  $: workspacePath = workspace?.path ?? null;

  // Surface settings reactively so a settings change (projectId, syncDir)
  // triggers a refresh.
  const settings = api.settings;
  const projectId = derived(settings, ($s) => ($s.projectId as string) ?? "");
  const syncDir = derived(settings, ($s) => ($s.syncDir as string) || ".");

  function clientNow() {
    const cfg = resolveAuthConfig(get(settings), {});
    return createSpacebaseClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
  }

  async function listDirRemote(path: string): Promise<DirEntry[]> {
    return api.invoke<DirEntry[]>("mcp_list_dir", {
      path,
      includeHidden: false,
    });
  }

  function joinPath(base: string, rel: string): string {
    const baseClean = base.replace(/\/+$/, "");
    if (rel === "" || rel === ".") return baseClean;
    const relClean = rel.replace(/^\/+/, "");
    return `${baseClean}/${relClean}`;
  }

  async function refresh(): Promise<void> {
    if (!workspacePath) {
      entries.set([]);
      return;
    }
    loading.set(true);
    error.set(null);
    try {
      const root = joinPath(workspacePath, get(syncDir));
      const localFiles = await walkMarkdownFiles(root, listDirRemote);
      const pid = get(projectId);
      let remoteDocs: DocSummary[] = [];
      const apiKey = (get(settings).apiKey as string) ?? "";
      if (pid && apiKey) {
        try {
          remoteDocs = await clientNow().listDocs(pid);
        } catch (err) {
          // Surface fetch failure as a non-fatal banner; still show local-only.
          const msg = err instanceof Error ? err.message : String(err);
          error.set(`Failed to load remote docs: ${msg}`);
        }
      }
      entries.set(computeDashboardEntries(localFiles, remoteDocs));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error.set(msg);
      entries.set([]);
    } finally {
      loading.set(false);
    }
  }

  onMount(() => {
    void refresh();
  });

  // Re-run when the workspace path or relevant settings change.
  let lastKey: string | null = null;
  $: {
    const key = `${workspacePath ?? ""}::${$projectId}::${$syncDir}`;
    if (key !== lastKey) {
      lastKey = key;
      void refresh();
    }
  }

  function onClickEntry(entry: DashboardEntry): void {
    if (entry.status === "remote-only" || !workspacePath) return;
    const abs = joinPath(workspacePath, get(syncDir));
    api.openPreviewSplit(`${abs.replace(/\/+$/, "")}/${entry.relPath}`);
  }

  function badgeColor(status: DashboardEntry["status"]): string {
    switch (status) {
      case "synced":
        return $theme.accent;
      case "locked":
        return $theme.fgMuted;
      case "local-only":
        return $theme.warning;
      case "remote-only":
        return $theme.fgMuted;
    }
  }

  function badgeLabel(status: DashboardEntry["status"]): string {
    switch (status) {
      case "synced":
        return "synced";
      case "locked":
        return "locked";
      case "local-only":
        return "local only";
      case "remote-only":
        return "remote only";
    }
  }
</script>

<div class="dash" style="background: {$theme.bg}; color: {$theme.fg};">
  <header style="border-bottom: 1px solid {$theme.border};">
    <div class="title-row">
      <h1 style="color: {$theme.fg};">Spacebase</h1>
      <button
        type="button"
        class="refresh"
        style="color: {$theme.fgMuted};"
        on:click={() => void refresh()}
        disabled={$loading}
      >
        {$loading ? "Refreshing…" : "Refresh"}
      </button>
    </div>
    <p style="color: {$theme.fgMuted};">
      {#if workspacePath}
        Local <code>{$syncDir}</code> in <code>{workspacePath}</code>
      {:else}
        No workspace path resolved.
      {/if}
    </p>
  </header>

  {#if $error}
    <p class="error" style="color: {$theme.danger};">{$error}</p>
  {/if}

  {#if $entries.length === 0 && !$loading}
    <p class="state" style="color: {$theme.fgMuted};">
      No markdown files to show.
    </p>
  {:else}
    <ul class="files">
      {#each $entries as entry (entry.relPath + ":" + entry.status)}
        <li>
          <button
            type="button"
            class="row"
            on:click={() => onClickEntry(entry)}
            disabled={entry.status === "remote-only"}
            style="color: {$theme.fg};"
          >
            <span class="rel" style="color: {$theme.accent};">
              {entry.relPath}
            </span>
            <span class="badge" style="color: {badgeColor(entry.status)};">
              {badgeLabel(entry.status)}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dash {
    height: 100%;
    overflow: auto;
    padding: 16px 20px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 13px;
  }
  header {
    padding-bottom: 12px;
    margin-bottom: 12px;
  }
  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  p {
    margin: 4px 0 0 0;
  }
  .refresh {
    background: none;
    border: 0;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    padding: 2px 6px;
  }
  .refresh:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .state,
  .error {
    font-size: 12px;
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .files > li {
    margin: 2px 0;
  }
  .row {
    display: flex;
    width: 100%;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    background: none;
    border: 0;
    padding: 4px 0;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:disabled {
    cursor: default;
  }
  .row:hover:not(:disabled) .rel {
    text-decoration: underline;
  }
  .rel {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  code {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 11px;
  }
</style>
