<script lang="ts">
  import { onMount, getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI, type DirEntry } from "../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const invoke = api.invoke;
  const theme = api.theme;
  const activeWorkspace = api.activeWorkspace;
  const activeSurface = api.activeSurface;
  const activePane = api.activePane;

  interface TreeRow {
    name: string;
    relPath: string;
    is_dir: boolean;
    depth: number;
  }

  let entries: DirEntry[] = [];
  let cwd = "";
  let loading = false;
  let showHidden = false;
  let showGitIgnored = false;
  let isGitRepo = false;
  let gitIgnoredNames: Set<string> = new Set();

  // Keyed by relative path from cwd (e.g. "src", "src/lib")
  let expandedDirs: Set<string> = new Set();
  let childEntries: Record<string, DirEntry[]> = {};

  // Flatten the tree into a list of rows for rendering
  $: visibleRows = buildVisibleRows(
    entries,
    expandedDirs,
    childEntries,
    showHidden,
    showGitIgnored,
  );

  function shouldShow(e: DirEntry): boolean {
    if (!showHidden && e.is_hidden) return false;
    if (!showGitIgnored && gitIgnoredNames.has(e.name)) return false;
    return true;
  }

  function buildVisibleRows(
    _entries: DirEntry[],
    _expanded: Set<string>,
    _children: Record<string, DirEntry[]>,
    _showHidden: boolean,
    _showGitIgnored: boolean,
  ): TreeRow[] {
    const rows: TreeRow[] = [];
    function walk(items: DirEntry[], parentPath: string, depth: number) {
      for (const entry of items) {
        if (!shouldShow(entry)) continue;
        const relPath = parentPath ? parentPath + "/" + entry.name : entry.name;
        rows.push({ name: entry.name, relPath, is_dir: entry.is_dir, depth });
        if (entry.is_dir && _expanded.has(relPath) && _children[relPath]) {
          walk(_children[relPath], relPath, depth + 1);
        }
      }
    }
    walk(_entries, "", 0);
    return rows;
  }

  async function loadFiles() {
    const dir = await api.getActiveCwd();
    if (!dir) return;
    if (dir === cwd) return;
    cwd = dir;
    loading = true;
    expandedDirs = new Set();
    childEntries = {};
    try {
      entries = await invoke<DirEntry[]>("list_dir", { path: dir });
      isGitRepo = await invoke<boolean>("is_git_repo", { path: dir });
      if (isGitRepo) {
        const ignored = await invoke<string[]>("list_gitignored", {
          path: dir,
        });
        gitIgnoredNames = new Set(ignored);
      } else {
        gitIgnoredNames = new Set();
      }
    } catch {
      entries = [];
      isGitRepo = false;
      gitIgnoredNames = new Set();
    }
    loading = false;
  }

  async function toggleDir(relPath: string) {
    if (expandedDirs.has(relPath)) {
      expandedDirs.delete(relPath);
      expandedDirs = new Set(expandedDirs);
    } else {
      expandedDirs.add(relPath);
      expandedDirs = new Set(expandedDirs);
      if (!childEntries[relPath]) {
        try {
          const absDir = cwd.replace(/\/$/, "") + "/" + relPath;
          childEntries[relPath] = await invoke<DirEntry[]>("list_dir", {
            path: absDir,
          });
          childEntries = { ...childEntries };
        } catch {
          childEntries[relPath] = [];
          childEntries = { ...childEntries };
        }
      }
    }
  }

  function toAbsPath(relPath: string): string {
    return cwd.replace(/\/$/, "") + "/" + relPath;
  }

  function handleFileClick(relPath: string) {
    api.openFile(toAbsPath(relPath));
  }

  function handleFileContextMenu(e: MouseEvent, relPath: string) {
    e.preventDefault();
    api.showFileContextMenu(e.clientX, e.clientY, toAbsPath(relPath));
  }

  function handleDirContextMenu(e: MouseEvent, relPath: string) {
    e.preventDefault();
    api.showDirContextMenu(e.clientX, e.clientY, toAbsPath(relPath));
  }

  onMount(loadFiles);

  // Single reactive block to avoid triple-firing loadFiles when multiple
  // stores change simultaneously (e.g., activating a surface changes both
  // activeSurface and activePane at the same time).
  $: if ($activeWorkspace || $activeSurface || $activePane) {
    void loadFiles();
  }
</script>

<div
  class="file-browser"
  style="flex: 1; overflow-y: auto; padding: 4px 0; font-size: 12px;"
>
  <!-- Control row -->
  <div
    style="display: flex; align-items: center; justify-content: flex-end; padding: 2px 8px; gap: 4px;"
  >
    <button
      title={showHidden ? "Hide hidden files" : "Show hidden files"}
      style="
        background: none; border: none; cursor: pointer; padding: 2px;
        color: {showHidden ? $theme.accent : $theme.fgDim};
        border-radius: 3px; line-height: 1; display: flex; align-items: center;
      "
      on:click={() => (showHidden = !showHidden)}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
        <circle cx="8" cy="8" r="2" />
        {#if !showHidden}<line x1="3" y1="13" x2="13" y2="3" />{/if}
      </svg>
    </button>
    {#if isGitRepo}
      <button
        title={showGitIgnored
          ? "Hide git-ignored files"
          : "Show git-ignored files"}
        style="
          background: none; border: none; cursor: pointer; padding: 2px 4px;
          color: {showGitIgnored
          ? $theme.accent
          : $theme.fgDim}; font-size: 12px;
          border-radius: 3px; line-height: 1; font-weight: bold;
        "
        on:click={() => (showGitIgnored = !showGitIgnored)}
      >
        .git
      </button>
    {/if}
  </div>

  {#if loading}
    <div style="color: {$theme.fgDim}; padding: 12px; font-style: italic;">
      Loading...
    </div>
  {:else if visibleRows.length === 0}
    <div style="color: {$theme.fgDim}; padding: 12px; font-style: italic;">
      No files found
    </div>
  {:else}
    {#each visibleRows as row (row.relPath)}
      {#if row.is_dir}
        <button
          class="file-item"
          style="
            width: 100%; background: none; border: none;
            padding: 3px 12px 3px {12 + row.depth * 16}px;
            color: {$theme.fg}; cursor: pointer; display: flex; align-items: center; gap: 4px;
            font-size: 12px; font-family: monospace; text-align: left;
            overflow: hidden; white-space: nowrap;
          "
          on:click={() => toggleDir(row.relPath)}
          on:contextmenu={(e) => handleDirContextMenu(e, row.relPath)}
        >
          <span
            class="chevron"
            style="display: inline-block; transition: transform 0.15s; transform: rotate({expandedDirs.has(
              row.relPath,
            )
              ? '90deg'
              : '0deg'});">{"\u203A"}</span
          >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke={$theme.accent}
            stroke-width="1.5"
            style="flex-shrink: 0;"
          >
            <path d="M1.5 3.5h5l1.5 1.5h6.5v8.5h-13z" />
          </svg>
          <span style="color: {$theme.accent};">{row.name}</span>
        </button>
      {:else}
        <button
          class="file-item"
          style="
            width: 100%; background: none; border: none;
            padding: 3px 12px 3px {12 + row.depth * 16 + 16}px;
            color: {$theme.fg}; cursor: pointer; display: flex; align-items: center; gap: 4px;
            font-size: 12px; font-family: monospace; text-align: left;
            overflow: hidden; white-space: nowrap;
          "
          on:click={() => handleFileClick(row.relPath)}
          on:contextmenu={(e) => handleFileContextMenu(e, row.relPath)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            style="flex-shrink: 0;"
          >
            <path d="M4 1.5h5l3.5 3.5v9.5h-8.5z" /><polyline
              points="9 1.5 9 5.5 12.5 5.5"
            />
          </svg>
          {row.name}
        </button>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .file-item:hover {
    background: rgba(255, 255, 255, 0.05) !important;
  }
  .chevron {
    font-size: 10px;
    width: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
</style>
