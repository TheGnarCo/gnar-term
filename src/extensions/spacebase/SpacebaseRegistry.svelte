<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { writable, get } from "svelte/store";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import { createSpacebaseClient, type DocSummary } from "./api-client";
  import { resolveAuthConfig } from "./auth-store";
  import { openDocFlow } from "./registry-data";
  import { __getSpacebaseAuthStoreForTest } from "./index";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  type ProjectDocs = {
    projectId: string;
    name: string;
    docs: DocSummary[] | null;
    error: string | null;
    loading: boolean;
  };

  const authStore = __getSpacebaseAuthStoreForTest();
  const projectDocs = writable<Record<string, ProjectDocs>>({});
  const loadError = writable<string | null>(null);

  $: status = authStore?.status;

  function clientNow() {
    const cfg = resolveAuthConfig(get(api.settings), {});
    return createSpacebaseClient({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
    });
  }

  async function loadDocs(projectId: string, name: string) {
    projectDocs.update((m) => ({
      ...m,
      [projectId]: { projectId, name, docs: null, error: null, loading: true },
    }));
    try {
      const docs = await clientNow().listDocs(projectId);
      projectDocs.update((m) => ({
        ...m,
        [projectId]: {
          projectId,
          name,
          docs,
          error: null,
          loading: false,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      projectDocs.update((m) => ({
        ...m,
        [projectId]: {
          projectId,
          name,
          docs: null,
          error: msg,
          loading: false,
        },
      }));
    }
  }

  async function openDoc(projectId: string, doc: DocSummary) {
    try {
      await openDocFlow(
        {
          client: clientNow(),
          ensureDir: (path) => api.invoke("ensure_dir", { path }),
          writeFile: (path, content) =>
            api.invoke("write_file", { path, content }),
          openPreviewSplit: (path) => api.openPreviewSplit(path),
          getHome: () => api.invoke<string>("get_home"),
        },
        projectId,
        doc.id,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      loadError.set(`Failed to open "${doc.title}": ${msg}`);
    }
  }

  onMount(() => {
    if (authStore) {
      void authStore.refresh();
    }
  });

  $: if ($status?.kind === "valid") {
    for (const p of $status.projects) {
      const existing = $projectDocs[p.id];
      if (!existing) void loadDocs(p.id, p.name);
    }
  }

  function fmtDocLabel(doc: DocSummary): string {
    return doc.folder_path ? `${doc.folder_path}/${doc.title}` : doc.title;
  }
</script>

<div class="registry" style="background: {$theme.bg}; color: {$theme.fg};">
  <header style="border-bottom: 1px solid {$theme.border};">
    <h1 style="color: {$theme.fg};">Spacebase</h1>
    <p style="color: {$theme.fgMuted};">
      Browse projects and docs. Click a doc to render it as a preview.
    </p>
  </header>

  {#if !authStore || !$status || $status.kind === "checking"}
    <p class="state" style="color: {$theme.fgMuted};">Checking…</p>
  {:else if $status.kind === "not-configured"}
    <p class="state" style="color: {$theme.fgMuted};">
      Set your API key in extension settings to browse Spacebase.
    </p>
  {:else if $status.kind === "invalid"}
    <p class="state" style="color: {$theme.danger};">
      Auth failed (status {$status.status}): {$status.message}
    </p>
  {:else}
    <ul class="projects">
      {#each $status.projects as project (project.id)}
        {@const entry = $projectDocs[project.id]}
        <li>
          <h2 style="color: {$theme.fg};">{project.name}</h2>
          {#if !entry || entry.loading}
            <p class="state" style="color: {$theme.fgMuted};">Loading…</p>
          {:else if entry.error}
            <p class="state" style="color: {$theme.danger};">
              {entry.error}
            </p>
          {:else if entry.docs && entry.docs.length === 0}
            <p class="state" style="color: {$theme.fgMuted};">No docs.</p>
          {:else if entry.docs}
            <ul class="docs">
              {#each entry.docs as doc (doc.id)}
                <li>
                  <button
                    type="button"
                    style="color: {$theme.accent};"
                    on:click={() => openDoc(project.id, doc)}
                  >
                    {fmtDocLabel(doc)}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if $loadError}
    <p class="error" style="color: {$theme.danger};">{$loadError}</p>
  {/if}
</div>

<style>
  .registry {
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
  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  h2 {
    margin: 0 0 6px 0;
    font-size: 13px;
    font-weight: 600;
  }
  p {
    margin: 0;
  }
  .state {
    font-size: 12px;
  }
  .projects,
  .docs {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .projects > li {
    margin-bottom: 14px;
  }
  .docs > li {
    margin: 2px 0;
  }
  .docs button {
    background: none;
    border: 0;
    padding: 2px 0;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .docs button:hover {
    text-decoration: underline;
  }
  .error {
    margin-top: 12px;
    font-size: 12px;
  }
</style>
