<script lang="ts">
  import { onMount, onDestroy, getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  interface FileStatus {
    path: string;
    status: string;
    staged: string;
  }

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  let files: FileStatus[] = [];
  let loading = false;
  let error = "";
  let lastMerge: { branch: string; baseBranch: string } | null = null;

  const STATUS_ICONS: Record<string, string> = {
    modified: "M",
    added: "A",
    deleted: "D",
    renamed: "R",
    copied: "C",
    untracked: "?",
  };

  const STATUS_COLORS: Record<string, string> = {
    modified: "#e8b73a",
    added: "#4ec957",
    deleted: "#f44",
    renamed: "#6bf",
    copied: "#6bf",
    untracked: "#888",
  };

  async function refresh() {
    const cwd = await api.getActiveCwd();
    if (!cwd) {
      error = "No active workspace";
      return;
    }

    loading = true;
    error = "";
    try {
      files = await api.invoke<FileStatus[]>("git_status", { repoPath: cwd });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      files = [];
    } finally {
      loading = false;
    }
  }

  function handleFileClick(file: FileStatus) {
    const cwd = api.state.get<string>("changes-cwd");
    if (!cwd) return;
    api.openSurface("diff", file.path.split("/").pop() || "Diff", {
      repoPath: cwd,
      filePath: file.path,
    });
  }

  // Register refresh callback for sidebar action
  api.state.set("changes-refresh", refresh);

  // Listen for merge events to auto-refresh
  const handleMerge = (event: unknown) => {
    const e = event as Record<string, unknown>;
    lastMerge = {
      branch: (e.branch as string) || "",
      baseBranch: (e.baseBranch as string) || "",
    };
    void refresh();
  };
  api.on("worktree:merged", handleMerge);

  onMount(() => {
    void refresh();
  });

  onDestroy(() => {
    api.off("worktree:merged", handleMerge);
  });
</script>

<div
  class="changes-tab"
  style="flex: 1; overflow-y: auto; padding: 4px 0; font-size: 12px;"
>
  {#if loading}
    <div style="color: {$theme.fgDim}; padding: 12px; font-style: italic;">
      Loading...
    </div>
  {:else if error}
    <div style="color: {$theme.fgDim}; padding: 12px; font-style: italic;">
      {error}
    </div>
  {:else}
    {#if lastMerge}
      <div
        style="
          padding: 6px 12px; font-size: 11px;
          color: {$theme.accent}; border-bottom: 1px solid {$theme.border};
        "
      >
        Merged {lastMerge.branch} into {lastMerge.baseBranch}
      </div>
    {/if}

    {#if files.length === 0}
      <div style="color: {$theme.fgDim}; padding: 12px; font-style: italic;">
        No changes
      </div>
    {:else}
      <div
        style="
          padding: 6px 12px; font-size: 11px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.5px;
          color: {$theme.fg}; border-bottom: 1px solid {$theme.border};
        "
      >
        Changed Files ({files.length})
      </div>
      {#each files as file (file.path)}
        <button
          class="list-item"
          style="
            width: 100%; background: none; border: none;
            padding: 4px 12px; color: {$theme.fg}; cursor: pointer;
            display: flex; align-items: center; gap: 8px;
            font-size: 12px; text-align: left;
          "
          on:click={() => handleFileClick(file)}
        >
          <span
            style="
              font-family: monospace; font-size: 11px; font-weight: 600;
              color: {STATUS_COLORS[file.status] || $theme.fgDim};
              width: 14px; text-align: center; flex-shrink: 0;
            "
          >
            {STATUS_ICONS[file.status] || "?"}
          </span>
          <span
            style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >
            {file.path}
          </span>
        </button>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .list-item:hover {
    background: rgba(255, 255, 255, 0.05) !important;
  }
</style>
