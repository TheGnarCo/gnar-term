<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { writable, get } from "svelte/store";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import {
    createSpacebaseClient,
    type DocSummary,
    type SpacebaseProjectRef,
  } from "./api-client";
  import { resolveAuthConfig } from "./auth-store";
  import { getSpacebaseAuthStore } from "./index";
  import { openDocFlow } from "./registry-data";
  import { buildDocTree } from "./doc-tree";
  import {
    loadRepoConfig,
    writeRepoConfig,
    type RepoConfigDeps,
  } from "./repo-config";
  import { workspaces } from "../../lib/stores/workspace";
  import DocTree from "./DocTree.svelte";

  export let rootWorkspaceId: string | undefined = undefined;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const authStore = getSpacebaseAuthStore();

  const docs = writable<DocSummary[]>([]);
  const loading = writable<boolean>(false);
  const error = writable<string | null>(null);
  const expandedFolders = writable<Set<string>>(new Set());
  const repoProjectId = writable<string | null>(null);
  const repoConfigLoaded = writable<boolean>(false);
  const savingAssociation = writable<boolean>(false);

  $: status = authStore?.status;
  $: settings = api.settings;

  // Resolve the host workspace's filesystem path so the dashboard can
  // read/write `<path>/.gnar-term/spacebase.json`. Tracks the live store
  // so a rename or path change reflows the repo-config lookup.
  $: workspacePath = (() => {
    if (!rootWorkspaceId) return null;
    const ws = $workspaces.find((w) => w.id === rootWorkspaceId);
    return ws?.path ?? null;
  })();

  const repoConfigDeps: RepoConfigDeps = {
    fileExists: (p) => api.invoke<boolean>("file_exists", { path: p }),
    readFile: (p) => api.invoke<string>("read_file", { path: p }),
    writeFile: (p, content) => api.invoke("write_file", { path: p, content }),
    ensureDir: (p) => api.invoke("ensure_dir", { path: p }),
  };

  // Repo config wins over auth-store resolved project id. When the repo
  // pins a projectId that the user no longer has access to, fall through
  // to the auth-store resolution rather than rendering a dead state.
  $: project = (() => {
    if (!$status || $status.kind !== "valid") return null;
    if ($repoProjectId) {
      const match = $status.projects.find((p) => p.id === $repoProjectId);
      if (match) return match;
    }
    const id = $status.resolvedProjectId;
    if (id) return $status.projects.find((p) => p.id === id) ?? null;
    return $status.projects.length === 1 ? $status.projects[0]! : null;
  })();

  function toggleFolder(path: string): void {
    expandedFolders.update((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function docPath(doc: DocSummary): string {
    return doc.folder_path ? `${doc.folder_path}/${doc.title}` : doc.title;
  }

  $: tree = buildDocTree($docs.map((d) => ({ path: docPath(d), data: d })));

  function clientNow() {
    const cfg = resolveAuthConfig(get(settings), {});
    return createSpacebaseClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
  }

  // Spacebase has no public POST /projects endpoint — projects are
  // minted in the web UI. The dashboard's "Create new project" button
  // hands off to the configured baseUrl so the user can finish there
  // and come back to associate it.
  function openCreateProjectInBrowser(): void {
    const cfg = resolveAuthConfig(get(settings), {});
    void api.invoke("open_url", { url: cfg.baseUrl });
  }

  async function refresh(): Promise<void> {
    if (!project) {
      docs.set([]);
      return;
    }
    loading.set(true);
    error.set(null);
    try {
      const list = await clientNow().listDocs(project.id);
      docs.set(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error.set(msg);
      docs.set([]);
    } finally {
      loading.set(false);
    }
  }

  async function loadAssociation(path: string): Promise<void> {
    repoConfigLoaded.set(false);
    try {
      const cfg = await loadRepoConfig(repoConfigDeps, path);
      repoProjectId.set(cfg?.projectId ?? null);
    } catch {
      repoProjectId.set(null);
    } finally {
      repoConfigLoaded.set(true);
    }
  }

  onMount(() => {
    if (authStore) void authStore.refresh();
  });

  // Re-load the repo config whenever the host workspace's path changes
  // (e.g. workspaces store hydrating after restore).
  let lastPathLoaded: string | null = null;
  $: if (workspacePath && workspacePath !== lastPathLoaded) {
    lastPathLoaded = workspacePath;
    void loadAssociation(workspacePath);
  }

  // Re-fetch whenever the resolved project changes (auth refresh,
  // repo association change, settings.projectId change, etc.).
  let lastProjectId: string | null = null;
  $: {
    const pid = project?.id ?? null;
    if (pid !== lastProjectId) {
      lastProjectId = pid;
      void refresh();
    }
  }

  async function associateProject(chosen: SpacebaseProjectRef): Promise<void> {
    if (!workspacePath) return;
    savingAssociation.set(true);
    error.set(null);
    try {
      await writeRepoConfig(repoConfigDeps, workspacePath, {
        projectId: chosen.id,
      });
      repoProjectId.set(chosen.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error.set(`Failed to save project association: ${msg}`);
    } finally {
      savingAssociation.set(false);
    }
  }

  async function clearAssociation(): Promise<void> {
    if (!workspacePath) return;
    savingAssociation.set(true);
    error.set(null);
    try {
      await writeRepoConfig(repoConfigDeps, workspacePath, {});
      repoProjectId.set(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error.set(`Failed to clear project association: ${msg}`);
    } finally {
      savingAssociation.set(false);
    }
  }

  async function openDoc(doc: DocSummary): Promise<void> {
    if (!project) return;
    try {
      await openDocFlow(
        {
          client: clientNow(),
          ensureDir: (path) => api.invoke("ensure_dir", { path }),
          writeFile: (path, content) =>
            api.invoke("write_file", { path, content }),
          openPreviewSplit: (path) =>
            api.openPreviewSplit(path, { ratio: 2 / 3, exclusive: true }),
          getHome: () => api.invoke<string>("get_home"),
        },
        project.id,
        doc.id,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error.set(`Failed to open "${doc.title}": ${msg}`);
    }
  }

  // Show the picker UI when auth is valid, the user has projects, but
  // we don't have a resolved project for this workspace yet (no repo
  // config and no global default selection).
  $: showPicker =
    $status?.kind === "valid" &&
    $repoConfigLoaded &&
    !project &&
    $status.projects.length > 0;
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
        disabled={$loading || !project}
      >
        {$loading ? "Refreshing…" : "Refresh"}
      </button>
    </div>
    <p style="color: {$theme.fgMuted};">
      {#if !authStore || !$status || $status.kind === "checking"}
        Checking…
      {:else if $status.kind === "not-configured"}
        Set your Spacebase API key in extension settings to load project docs.
      {:else if $status.kind === "invalid"}
        Auth failed (status {$status.status}): {$status.message}
      {:else if project}
        Project <code>{project.name}</code>
        {#if $repoProjectId === project.id && workspacePath}
          <button
            type="button"
            class="disassociate"
            style="color: {$theme.fgMuted}; border-color: {$theme.border};"
            on:click={() => void clearAssociation()}
            disabled={$savingAssociation}
            title="Remove this workspace's project pin"
          >
            Disassociate
          </button>
        {/if}
      {:else}
        This workspace isn't associated with a Spacebase project.
      {/if}
    </p>
  </header>

  {#if $error}
    <p class="error" style="color: {$theme.danger};">{$error}</p>
  {/if}

  {#if showPicker && $status?.kind === "valid"}
    <div class="picker">
      <p style="color: {$theme.fgMuted};">
        This workspace isn't associated with a Spacebase project yet. Associate
        it with an existing project, or create a new one.
      </p>
      <h3 class="picker-heading" style="color: {$theme.fg};">
        Associate with an existing project
      </h3>
      <ul>
        {#each $status.projects as p (p.id)}
          <li>
            <button
              type="button"
              class="picker-btn"
              style="color: {$theme.accent}; border-color: {$theme.border};"
              on:click={() => void associateProject(p)}
              disabled={$savingAssociation}
            >
              {p.name}
            </button>
          </li>
        {/each}
      </ul>
      <h3 class="picker-heading" style="color: {$theme.fg};">
        Or create a new one
      </h3>
      <p class="picker-help" style="color: {$theme.fgMuted};">
        Spacebase projects are created in the web app. We'll open it in your
        browser; come back here once the project exists to associate it.
      </p>
      <button
        type="button"
        class="picker-btn picker-create"
        style="color: {$theme.accent}; border-color: {$theme.border};"
        on:click={openCreateProjectInBrowser}
        disabled={$savingAssociation}
      >
        Create new project in Spacebase…
      </button>
      <p class="picker-help" style="color: {$theme.fgDim ?? $theme.fgMuted};">
        Selection saved to <code>.gnar-term/spacebase.json</code>.
      </p>
    </div>
  {/if}

  {#if project}
    {#if $loading && $docs.length === 0}
      <p class="state" style="color: {$theme.fgMuted};">Loading…</p>
    {:else if $docs.length === 0}
      <p class="state" style="color: {$theme.fgMuted};">
        No Spacebase docs in <code>{project.name}</code> yet.
      </p>
    {:else}
      <DocTree
        nodes={tree}
        expanded={$expandedFolders}
        onToggle={toggleFolder}
        folderColor={$theme.fg}
        chevronColor={$theme.fgMuted}
      >
        {#snippet leaf({ node })}
          <button
            type="button"
            class="leaf-btn"
            style="color: {$theme.accent};"
            on:click={() => openDoc(node.data)}
          >
            {node.name}
          </button>
        {/snippet}
      </DocTree>
    {/if}
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
  .disassociate {
    background: none;
    border: 1px solid;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    padding: 2px 8px;
    margin-left: 6px;
  }
  .disassociate:hover:not(:disabled) {
    text-decoration: underline;
  }
  .disassociate:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .state,
  .error {
    font-size: 12px;
  }
  .leaf-btn {
    background: none;
    border: 0;
    padding: 2px 0;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .leaf-btn:hover {
    text-decoration: underline;
  }
  .picker {
    margin: 12px 0;
  }
  .picker-heading {
    margin: 14px 0 6px 0;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .picker-help {
    margin: 4px 0 0 0;
    font-size: 12px;
  }
  .picker-create {
    margin-top: 8px;
  }
  .picker ul {
    list-style: none;
    padding: 0;
    margin: 8px 0 0 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .picker-btn {
    background: none;
    border: 1px solid;
    padding: 6px 10px;
    font: inherit;
    cursor: pointer;
    text-align: left;
    border-radius: 4px;
  }
  .picker-btn:hover:not(:disabled) {
    text-decoration: underline;
  }
  .picker-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  code {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 11px;
  }
</style>
