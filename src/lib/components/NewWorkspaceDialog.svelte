<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { newWorkspaceDialog } from "../stores/dialog-service";
  import { dialogStyles } from "../dialog-utils";
  import { getState } from "../state";
  import Dialog from "./Dialog.svelte";
  import type { BranchInfo, WorktreeInfo } from "../git";

  let tab: "terminal" | "managed" = "terminal";
  let managedMode: "new-branch" | "existing" = "new-branch";
  let terminalName = "Terminal";
  let branchName = "";
  let baseBranch = "main";
  let existingSelection = "";
  let inputEl: HTMLInputElement;
  let error = "";
  let branches: BranchInfo[] = [];
  let worktrees: WorktreeInfo[] = [];
  let loadingBranches = false;
  let fetching = false;
  let loadError = "";

  const adjectives = [
    "swift",
    "bold",
    "calm",
    "dark",
    "keen",
    "warm",
    "cool",
    "pure",
    "deep",
    "fair",
    "wild",
    "soft",
    "bright",
    "quick",
    "steady",
    "sharp",
    "clear",
    "fresh",
    "light",
    "smooth",
  ];
  const nouns = [
    "oak",
    "fox",
    "lake",
    "wave",
    "pine",
    "hawk",
    "reef",
    "peak",
    "ridge",
    "fern",
    "brook",
    "flint",
    "sage",
    "dusk",
    "grove",
    "marsh",
    "cliff",
    "bloom",
    "crest",
    "vale",
  ];
  const verbs = [
    "drift",
    "spark",
    "forge",
    "weave",
    "shift",
    "trace",
    "carve",
    "blend",
    "craft",
    "sweep",
    "climb",
    "glide",
    "chart",
    "build",
    "mend",
    "hone",
    "tend",
    "link",
    "shape",
    "plant",
  ];

  function randomWord(list: string[]): string {
    return list[Math.floor(Math.random() * list.length)];
  }

  function generateBranchName(prefix: string): string {
    return `${prefix}${randomWord(adjectives)}-${randomWord(nouns)}-${randomWord(verbs)}`;
  }

  async function loadData(projectPath: string) {
    loadingBranches = true;
    try {
      const { listBranches, listWorktrees } = await import("../git");
      const [b, w] = await Promise.all([
        listBranches(projectPath, true),
        listWorktrees(projectPath),
      ]);
      branches = b;
      worktrees = w.filter((wt) => !wt.isBare && wt.path !== projectPath);
      loadError = "";
      const current = branches.find((b) => b.isCurrent);
      baseBranch = current?.name || "main";
      // Default "Existing" select to current branch
      if (current) existingSelection = `br:${current.name}`;
    } catch (err) {
      console.warn("Failed to fetch branches:", err);
      loadError = `Failed to load branches: ${err}`;
      branches = [];
      worktrees = [];
    }
    loadingBranches = false;
  }

  async function fetchRemotes() {
    if (!$newWorkspaceDialog || fetching) return;
    fetching = true;
    try {
      const { fetchAll } = await import("../git");
      await fetchAll($newWorkspaceDialog.projectPath);
      await loadData($newWorkspaceDialog.projectPath);
    } catch (err) {
      console.warn("Fetch failed:", err);
    }
    fetching = false;
  }

  function nextTerminalName(projectId: string): string {
    const project = getState().projects.find((p) => p.id === projectId);
    const existing =
      project?.workspaces.filter((w) => w.type === "terminal") || [];
    const usedNames = new Set(existing.map((w) => w.name));
    let n = existing.length + 1;
    let name = `Terminal ${n}`;
    while (usedNames.has(name)) {
      n++;
      name = `Terminal ${n}`;
    }
    return name;
  }

  const unsub = newWorkspaceDialog.subscribe((val) => {
    if (val) {
      tab = "terminal";
      managedMode = "new-branch";
      terminalName = nextTerminalName(val.projectId);
      branchName = generateBranchName(val.branchPrefix);
      baseBranch = "main";
      existingSelection = "";
      error = "";
      loadError = "";
      branches = [];
      worktrees = [];
      loadData(val.projectPath);
      tick().then(() => inputEl?.focus());
    }
  });
  onDestroy(unsub);

  function submit() {
    if (!$newWorkspaceDialog) return;
    if (tab === "terminal") {
      if (!terminalName.trim()) {
        error = "Name is required";
        return;
      }
      $newWorkspaceDialog.resolve({
        type: "terminal",
        name: terminalName.trim(),
      });
    } else if (managedMode === "new-branch") {
      if (!branchName.trim()) {
        error = "Branch name is required";
        return;
      }
      if (!baseBranch.trim()) {
        error = "Base branch is required";
        return;
      }
      $newWorkspaceDialog.resolve({
        type: "managed",
        branch: branchName.trim(),
        baseBranch: baseBranch.trim(),
      });
    } else {
      if (!existingSelection) {
        error = "Select a branch or worktree";
        return;
      }
      if (existingSelection.startsWith("wt:")) {
        const wtPath = existingSelection.slice(3);
        const wt = worktrees.find((w) => w.path === wtPath);
        if (!wt) {
          error = "Worktree not found";
          return;
        }
        $newWorkspaceDialog.resolve({
          type: "existing-worktree",
          worktreePath: wt.path,
          branch: wt.branch,
        });
      } else if (existingSelection.startsWith("br:")) {
        const brName = existingSelection.slice(3);
        $newWorkspaceDialog.resolve({
          type: "existing-worktree",
          worktreePath: $newWorkspaceDialog.projectPath,
          branch: brName,
        });
      } else {
        error = "Invalid selection";
        return;
      }
    }
    error = "";
    newWorkspaceDialog.set(null);
  }

  function cancel() {
    if (!$newWorkspaceDialog) return;
    $newWorkspaceDialog.resolve(null);
    newWorkspaceDialog.set(null);
  }

  $: styles = dialogStyles($theme);
  $: localBranches = branches.filter((b) => !b.isRemote);
  $: remoteBranches = branches.filter((b) => b.isRemote);

  // For "Existing" mode — branches that don't already have a worktree
  $: worktreeBranches = new Set(worktrees.map((w) => w.branch));
  $: availableLocal = localBranches.filter(
    (b) => !worktreeBranches.has(b.name),
  );
  $: availableRemote = remoteBranches.filter(
    (b) => !worktreeBranches.has(b.name),
  );
</script>

<Dialog
  visible={!!$newWorkspaceDialog}
  title="New Workspace"
  submitLabel={tab === "managed" && managedMode === "existing"
    ? existingSelection.startsWith("wt:")
      ? "Attach"
      : "Create"
    : "Create"}
  onCancel={cancel}
  onSubmit={submit}
>
  <!-- Top-level tabs: Terminal / Managed -->
  <div style="display: flex; border-bottom: 1px solid {$theme.border};">
    <button
      style={styles.tab(tab === "terminal")}
      on:click={() => {
        tab = "terminal";
        error = "";
        tick().then(() => inputEl?.focus());
      }}>Terminal</button
    >
    {#if $newWorkspaceDialog?.gitBacked}
      <button
        style={styles.tab(tab === "managed")}
        on:click={() => {
          tab = "managed";
          error = "";
          tick().then(() => inputEl?.focus());
        }}>Managed</button
      >
    {/if}
  </div>

  {#if tab === "terminal"}
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <label for="nw-name" style={styles.label}>Terminal name</label>
      <input
        id="nw-name"
        bind:this={inputEl}
        type="text"
        placeholder="Terminal"
        bind:value={terminalName}
        style={styles.input}
      />
    </div>
  {:else}
    <!-- Managed sub-tabs -->
    <div style="display: flex; gap: 0; margin-bottom: 8px;">
      <button
        style="
          flex: 1; padding: 6px 0; border: 1px solid {$theme.border}; cursor: pointer;
          font-size: 12px; border-radius: 6px 0 0 6px;
          background: {managedMode === 'new-branch'
          ? $theme.bgActive
          : 'transparent'};
          color: {managedMode === 'new-branch' ? $theme.fg : $theme.fgMuted};
          font-weight: {managedMode === 'new-branch' ? '600' : '400'};
        "
        on:click={() => {
          managedMode = "new-branch";
          existingSelection = "";
          error = "";
        }}>New</button
      >
      <button
        style="
          flex: 1; padding: 6px 0; border: 1px solid {$theme.border}; border-left: none; cursor: pointer;
          font-size: 12px; border-radius: 0 6px 6px 0;
          background: {managedMode === 'existing'
          ? $theme.bgActive
          : 'transparent'};
          color: {managedMode === 'existing' ? $theme.fg : $theme.fgMuted};
          font-weight: {managedMode === 'existing' ? '600' : '400'};
        "
        on:click={() => {
          managedMode = "existing";
          error = "";
        }}>Existing</button
      >
    </div>

    {#if managedMode === "new-branch"}
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label for="nw-branch" style={styles.label}>Branch name</label>
          <input
            id="nw-branch"
            bind:this={inputEl}
            type="text"
            placeholder="feature/my-branch"
            bind:value={branchName}
            style={styles.input}
          />
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div
            style="display: flex; align-items: center; justify-content: space-between;"
          >
            <label for="nw-base" style={styles.label}>Based on</label>
            <button
              class="fetch-btn"
              style="font-size: 11px; padding: 2px 8px; border-radius: 4px; border: 1px solid {$theme.border}; background: none; color: {$theme.fgMuted}; cursor: pointer;"
              disabled={fetching}
              on:click|stopPropagation={fetchRemotes}
              >{fetching ? "Fetching..." : "Fetch Remotes"}</button
            >
          </div>
          {#if loadingBranches}
            <div
              style="padding: 10px 14px; font-size: 13px; color: {$theme.fgDim};"
            >
              Loading branches...
            </div>
          {:else if loadError}
            <div
              style="padding: 8px 12px; font-size: 12px; color: {$theme.danger}; background: rgba(255,0,0,0.05); border-radius: 4px;"
            >
              {loadError}
            </div>
          {:else if branches.length === 0}
            <div
              style="padding: 8px 12px; font-size: 12px; color: {$theme.fgMuted};"
            >
              No branches found. Try "Fetch Remotes".
            </div>
          {:else}
            <select id="nw-base" bind:value={baseBranch} style={styles.select}>
              {#if localBranches.length > 0}
                <optgroup label="Local">
                  {#each localBranches as b}
                    <option value={b.name}
                      >{b.name}{b.isCurrent ? " (current)" : ""}</option
                    >
                  {/each}
                </optgroup>
              {/if}
              {#if remoteBranches.length > 0}
                <optgroup label="Remote">
                  {#each remoteBranches as b}
                    <option value={b.name}>{b.name}</option>
                  {/each}
                </optgroup>
              {/if}
            </select>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Existing branches & worktrees select -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div
          style="display: flex; align-items: center; justify-content: space-between;"
        >
          <label for="nw-existing" style={styles.label}
            >Branch or worktree</label
          >
          <button
            class="fetch-btn"
            style="font-size: 11px; padding: 2px 8px; border-radius: 4px; border: 1px solid {$theme.border}; background: none; color: {$theme.fgMuted}; cursor: pointer;"
            disabled={fetching}
            on:click|stopPropagation={fetchRemotes}
            >{fetching ? "Fetching..." : "Fetch Remotes"}</button
          >
        </div>
        {#if loadingBranches}
          <div
            style="padding: 10px 14px; font-size: 13px; color: {$theme.fgDim};"
          >
            Loading...
          </div>
        {:else if loadError}
          <div
            style="padding: 8px 12px; font-size: 12px; color: {$theme.danger}; background: rgba(255,0,0,0.05); border-radius: 4px;"
          >
            {loadError}
          </div>
        {:else}
          <select
            id="nw-existing"
            bind:value={existingSelection}
            style={styles.select}
          >
            <option value="" disabled>Select...</option>
            {#if worktrees.length > 0}
              <optgroup label="Worktrees">
                {#each worktrees as wt}
                  <option value="wt:{wt.path}">{wt.branch} ({wt.path})</option>
                {/each}
              </optgroup>
            {/if}
            {#if availableLocal.length > 0}
              <optgroup label="Local Branches">
                {#each availableLocal as b}
                  <option value="br:{b.name}"
                    >{b.name}{b.isCurrent ? " (current)" : ""}</option
                  >
                {/each}
              </optgroup>
            {/if}
            {#if availableRemote.length > 0}
              <optgroup label="Remote Branches">
                {#each availableRemote as b}
                  <option value="br:{b.name}">{b.name}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        {/if}
      </div>
    {/if}
  {/if}

  {#if error}
    <div style="font-size: 12px; color: {$theme.danger || '#e55'};">
      {error}
    </div>
  {/if}
</Dialog>

<style>
  .fetch-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05) !important;
  }
  .fetch-btn:disabled {
    opacity: 0.5;
    cursor: default !important;
  }
</style>
