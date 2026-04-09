<script lang="ts">
  import { theme } from "../stores/theme";
  import { pendingAction } from "../stores/ui";
  import type { WorkspaceRecord } from "../types";
  import type { FileStatus } from "../git";
  import {
    fetchChanges,
    fetchFiles,
    shouldShowRightSidebar,
  } from "../right-sidebar-data";
  import { startSidebarResize } from "../sidebar-resize";

  export let meta: WorkspaceRecord | undefined = undefined;
  export let visible = false;
  export let projectPath: string | undefined = undefined;
  export let gitBacked = false;
  export let activeCwd: string | undefined = undefined;

  let activeTab: "diff" | "files" = "files";
  $: if (!gitBacked && activeTab === "diff") activeTab = "files";
  let sidebarWidth = 220;
  let dragging = false;

  function startResize(e: MouseEvent) {
    dragging = true;
    startSidebarResize(
      e,
      "right",
      sidebarWidth,
      160,
      0.45,
      (w) => (sidebarWidth = w),
      () => (dragging = false),
    );
  }
  let files: string[] = [];
  let trackedFiles: Set<string> = new Set();
  let changes: FileStatus[] = [];
  let loading = false;
  let showIgnored = false;

  let filesExpandedDirs = new Set<string>();
  let diffExpandedDirs = new Set<string>();

  // --- Tree building ---

  interface TreeNode {
    name: string;
    path: string;
    isDir: boolean;
    children: TreeNode[];
    status?: string;
  }

  interface FlatEntry {
    name: string;
    path: string;
    isDir: boolean;
    depth: number;
    status?: string;
    childCount?: number;
  }

  function buildTree(
    paths: string[],
    statusMap?: Map<string, string>,
  ): TreeNode[] {
    const root: TreeNode[] = [];
    for (const filePath of paths) {
      const parts = filePath.split("/");
      let current = root;
      let acc = "";
      for (let i = 0; i < parts.length; i++) {
        acc = acc ? acc + "/" + parts[i] : parts[i];
        const isLast = i === parts.length - 1;
        let node = current.find(
          (n) => n.name === parts[i] && n.isDir !== isLast,
        );
        if (!node) {
          node = {
            name: parts[i],
            path: acc,
            isDir: !isLast,
            children: [],
            status: isLast ? statusMap?.get(filePath) : undefined,
          };
          current.push(node);
        }
        current = node.children;
      }
    }
    sortTree(root);
    return root;
  }

  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
    );
    for (const n of nodes) sortTree(n.children);
  }

  function countFiles(node: TreeNode): number {
    if (!node.isDir) return 1;
    return node.children.reduce((sum, c) => sum + countFiles(c), 0);
  }

  function flattenVisible(
    nodes: TreeNode[],
    depth: number,
    expanded: Set<string>,
  ): FlatEntry[] {
    const result: FlatEntry[] = [];
    for (const node of nodes) {
      result.push({
        name: node.name,
        path: node.path,
        isDir: node.isDir,
        depth,
        status: node.status,
        childCount: node.isDir ? countFiles(node) : undefined,
      });
      if (node.isDir && expanded.has(node.path)) {
        result.push(...flattenVisible(node.children, depth + 1, expanded));
      }
    }
    return result;
  }

  function collectAllDirs(nodes: TreeNode[]): string[] {
    const dirs: string[] = [];
    for (const n of nodes) {
      if (n.isDir) {
        dirs.push(n.path);
        dirs.push(...collectAllDirs(n.children));
      }
    }
    return dirs;
  }

  // --- Reactive trees ---

  $: displayFiles =
    showIgnored || !gitBacked
      ? files
      : files.filter((f) => trackedFiles.has(f));
  $: fileTree = buildTree(displayFiles);
  $: changeStatusMap = new Map(changes.map((c) => [c.path, displayStatus(c)]));
  $: changeTree = buildTree(
    changes.map((c) => c.path),
    changeStatusMap,
  );
  $: visibleFiles = flattenVisible(fileTree, 0, filesExpandedDirs);
  $: visibleChanges = flattenVisible(changeTree, 0, diffExpandedDirs);

  // --- Diff summary stats ---

  $: diffStats = (() => {
    let added = 0,
      modified = 0,
      deleted = 0;
    for (const c of changes) {
      const s = displayStatus(c);
      if (s === "A" || s === "?") added++;
      else if (s === "D") deleted++;
      else modified++;
    }
    return { total: changes.length, added, modified, deleted };
  })();

  // --- Data fetching ---

  $: gitRoot = meta?.worktreePath || projectPath;
  $: filesRoot = activeCwd || gitRoot;

  async function refresh() {
    if (!meta || !shouldShowRightSidebar(meta) || !filesRoot) return;
    loading = true;
    try {
      const fileFetch = fetchFiles(filesRoot);
      const changeFetch =
        gitBacked && gitRoot ? fetchChanges(gitRoot) : Promise.resolve([]);
      const trackedFetch =
        gitBacked && gitRoot
          ? import("../git")
              .then((m) => m.gitLsFiles(gitRoot!))
              .catch(() => [] as string[])
          : Promise.resolve([] as string[]);
      const [allFiles, changeResults, tracked] = await Promise.all([
        fileFetch,
        changeFetch,
        trackedFetch,
      ]);
      files = allFiles;
      changes = changeResults;
      trackedFiles = new Set(tracked);
      // Expand all dirs in diff view (usually small)
      const ct = buildTree(
        changes.map((c) => c.path),
        new Map(changes.map((c) => [c.path, displayStatus(c)])),
      );
      diffExpandedDirs = new Set(collectAllDirs(ct));
      // Expand only top-level dirs in files view
      const ft = buildTree(files);
      filesExpandedDirs = new Set(ft.filter((n) => n.isDir).map((n) => n.path));
    } finally {
      loading = false;
    }
  }

  $: if (visible && filesRoot) {
    refresh();
  }

  // --- Helpers ---

  function displayStatus(file: FileStatus): string {
    if (file.workStatus && file.workStatus !== " ") return file.workStatus;
    if (file.indexStatus && file.indexStatus !== " ") return file.indexStatus;
    return "?";
  }

  function statusColor(status: string): string {
    switch (status) {
      case "M":
        return $theme.ansi.yellow;
      case "A":
        return $theme.ansi.green;
      case "D":
        return $theme.ansi.red;
      case "?":
        return $theme.ansi.green;
      default:
        return $theme.fg;
    }
  }

  function toggleDir(tab: "files" | "diff", path: string) {
    if (tab === "files") {
      const next = new Set(filesExpandedDirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      filesExpandedDirs = next;
    } else {
      const next = new Set(diffExpandedDirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      diffExpandedDirs = next;
    }
  }

  function handleFileClick(relativePath: string) {
    const root = filesRoot;
    if (!root) return;
    const fullPath = root.replace(/\/$/, "") + "/" + relativePath;
    pendingAction.set({ type: "open-in-editor", payload: fullPath });
  }
</script>

{#if visible && shouldShowRightSidebar(meta)}
  <div
    class="right-sidebar"
    style="
      width: {sidebarWidth}px; min-width: 160px;
      background: {$theme.sidebarBg}; border-left: 1px solid {$theme.bg};
      display: flex; flex-direction: row; overflow: hidden;
      font-size: 13px; user-select: {dragging ? 'none' : 'auto'};
      position: relative;
    "
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="resize-handle"
      style="
      width: 4px; cursor: col-resize; flex-shrink: 0;
      background: {dragging ? $theme.accent : 'transparent'};
    "
      on:mousedown={startResize}
    ></div>
    <div
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"
    >
      <!-- Tab bar (matches main TabBar: 28px height) -->
      <div
        style="
        display: flex; align-items: center; gap: 1px;
        background: {$theme.tabBarBg}; border-bottom: none;
        height: 28px; padding: 0 4px; flex-shrink: 0;
      "
      >
        <button
          style="
          background: {activeTab === 'diff' ? $theme.bgActive : 'transparent'};
          border: none; padding: 2px 10px; cursor: {gitBacked
            ? 'pointer'
            : 'default'};
          font-size: 11px; font-weight: {activeTab === 'diff' ? '600' : '400'};
          color: {!gitBacked
            ? $theme.fgDim + '60'
            : activeTab === 'diff'
              ? $theme.fg
              : $theme.fgMuted};
          border-radius: 4px 4px 0 0; white-space: nowrap;
          opacity: {gitBacked ? '1' : '0.5'};
        "
          disabled={!gitBacked}
          on:click={() => {
            if (gitBacked) activeTab = "diff";
          }}>Diff</button
        >
        <button
          style="
          background: {activeTab === 'files' ? $theme.bgActive : 'transparent'};
          border: none; padding: 2px 10px; cursor: pointer;
          font-size: 11px; font-weight: {activeTab === 'files' ? '600' : '400'};
          color: {activeTab === 'files' ? $theme.fg : $theme.fgMuted};
          border-radius: 4px 4px 0 0; white-space: nowrap;
        "
          on:click={() => (activeTab = "files")}>Files</button
        >
        <span style="flex: 1;"></span>
        {#if activeTab === "files" && gitBacked}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            style="
              cursor: pointer; padding: 2px 4px; border-radius: 3px;
              color: {showIgnored ? $theme.accent : $theme.fgDim};
              opacity: {showIgnored ? '1' : '0.6'};
              font-size: 10px;
            "
            title={showIgnored
              ? "Showing all files (click to hide ignored)"
              : "Showing tracked files only (click to show all)"}
            on:click={() => (showIgnored = !showIgnored)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
              style="vertical-align: middle;"
            >
              {#if showIgnored}
                <path
                  d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.831.88 9.577.43 8.899a1.62 1.62 0 0 1 0-1.798c.45-.678 1.367-1.932 2.637-3.023C4.33 2.992 6.019 2 8 2zM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.824.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717zM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10z"
                />
              {:else}
                <path
                  d="M.143 2.31a.75.75 0 0 1 1.047-.167l14.5 10.5a.75.75 0 1 1-.88 1.214l-2.248-1.628C11.346 13.19 9.792 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.831.88 9.577.43 8.899a1.618 1.618 0 0 1 0-1.798c.321-.484.898-1.283 1.7-2.116L.31 3.357A.75.75 0 0 1 .143 2.31zm3.386 4.118a.12.12 0 0 0 0 .136c.412.621 1.242 1.75 2.366 2.717C7.176 10.258 8.527 11 10 11c.195 0 .388-.009.579-.025L3.529 6.428zM13.863 12.19C15.114 11.205 15.996 10.048 16.43 9.399a1.618 1.618 0 0 0 0-1.798c-.45-.678-1.367-1.932-2.637-3.023C12.563 3.492 10.981 2.5 9 2.5c-1.147 0-2.158.362-3.04.855L13.863 12.19z"
                />
              {/if}
            </svg>
          </span>
        {/if}
      </div>

      <!-- Tab content -->
      <div style="flex: 1; overflow-y: auto; padding: 4px 0;">
        {#if loading}
          <div
            style="padding: 12px; color: {$theme.fgMuted}; font-size: 12px; text-align: center;"
          >
            Loading...
          </div>
        {:else if activeTab === "diff"}
          <!-- Diff summary bar -->
          {#if changes.length > 0}
            <div
              style="
              padding: 6px 10px; margin: 2px 4px 4px; border-radius: 4px;
              background: rgba(255,255,255,0.03);
              display: flex; align-items: center; gap: 8px;
              font-size: 11px; color: {$theme.fgMuted};
            "
            >
              <span
                >{diffStats.total} file{diffStats.total !== 1 ? "s" : ""}</span
              >
              <span style="flex: 1;"></span>
              {#if diffStats.added > 0}
                <span style="color: {$theme.ansi.green};"
                  >+{diffStats.added}</span
                >
              {/if}
              {#if diffStats.modified > 0}
                <span style="color: {$theme.ansi.yellow};"
                  >~{diffStats.modified}</span
                >
              {/if}
              {#if diffStats.deleted > 0}
                <span style="color: {$theme.ansi.red};"
                  >-{diffStats.deleted}</span
                >
              {/if}
            </div>
          {/if}

          <!-- Changed files tree -->
          {#if changes.length === 0}
            <div
              style="padding: 12px; color: {$theme.fgMuted}; font-size: 12px; text-align: center;"
            >
              No changes
            </div>
          {:else}
            {#each visibleChanges as entry (entry.path)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                style="
                padding: 3px 8px 3px {8 + entry.depth * 16}px;
                margin: 0 4px; border-radius: 3px;
                display: flex; align-items: center; gap: 5px;
                cursor: {entry.isDir ? 'pointer' : 'default'};
                font-size: 12px; color: {$theme.fg};
              "
                on:click={() => entry.isDir && toggleDir("diff", entry.path)}
                on:mouseenter={(e) =>
                  (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                on:mouseleave={(e) =>
                  (e.currentTarget.style.background = "transparent")}
              >
                {#if entry.isDir}
                  <span
                    style="width: 12px; text-align: center; font-size: 10px; color: {$theme.fgDim}; flex-shrink: 0;"
                  >
                    {diffExpandedDirs.has(entry.path) ? "\u25BE" : "\u25B8"}
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill={$theme.fgDim}
                    style="flex-shrink: 0;"
                  >
                    <path
                      d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z"
                    />
                  </svg>
                  <span
                    style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; color: {$theme.fgMuted};"
                  >
                    {entry.name}
                  </span>
                {:else}
                  <span
                    style="width: 12px; text-align: center; font-weight: 600; font-size: 10px; flex-shrink: 0; color: {statusColor(
                      entry.status || '?',
                    )};"
                  >
                    {entry.status}
                  </span>
                  <span
                    style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; color: {statusColor(
                      entry.status || '?',
                    )};"
                  >
                    {entry.name}
                  </span>
                {/if}
              </div>
            {/each}
          {/if}
        {:else}
          <!-- Files tree -->
          {#if files.length === 0}
            <div
              style="padding: 12px; color: {$theme.fgMuted}; font-size: 12px; text-align: center;"
            >
              No tracked files
            </div>
          {:else}
            {#each visibleFiles as entry (entry.path)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                style="
                padding: 3px 8px 3px {8 + entry.depth * 16}px;
                margin: 0 4px; border-radius: 3px;
                display: flex; align-items: center; gap: 5px;
                cursor: pointer; font-size: 12px; color: {$theme.fg};
              "
                on:click={() =>
                  entry.isDir
                    ? toggleDir("files", entry.path)
                    : handleFileClick(entry.path)}
                on:mouseenter={(e) =>
                  (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                on:mouseleave={(e) =>
                  (e.currentTarget.style.background = "transparent")}
              >
                {#if entry.isDir}
                  <span
                    style="width: 12px; text-align: center; font-size: 10px; color: {$theme.fgDim}; flex-shrink: 0;"
                  >
                    {filesExpandedDirs.has(entry.path) ? "\u25BE" : "\u25B8"}
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill={$theme.fgDim}
                    style="flex-shrink: 0;"
                  >
                    <path
                      d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z"
                    />
                  </svg>
                  <span
                    style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; color: {$theme.fgMuted};"
                  >
                    {entry.name}
                  </span>
                  {#if entry.childCount}
                    <span
                      style="font-size: 10px; color: {$theme.fgDim}; flex-shrink: 0;"
                      >{entry.childCount}</span
                    >
                  {/if}
                {:else}
                  {@const isTracked =
                    !gitBacked || trackedFiles.has(entry.path)}
                  <span style="width: 12px; flex-shrink: 0;"></span>
                  <span
                    style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; {isTracked
                      ? ''
                      : `color: ${$theme.fgDim}; opacity: 0.6; font-style: italic;`}"
                  >
                    {entry.name}
                  </span>
                  {#if !isTracked}
                    <span
                      style="font-size: 9px; color: {$theme.fgDim}; flex-shrink: 0; opacity: 0.6;"
                      >ignored</span
                    >
                  {/if}
                {/if}
              </div>
            {/each}
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .resize-handle:hover {
    background: rgba(255, 255, 255, 0.08) !important;
  }
</style>
