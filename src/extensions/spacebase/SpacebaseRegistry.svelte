<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { writable, get } from "svelte/store";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import { createSpacebaseClient, type DocSummary } from "./api-client";
  import { resolveAuthConfig } from "./auth-store";
  import { openDocFlow } from "./registry-data";
  import { __getSpacebaseAuthStoreForTest } from "./index";
  import { buildDocTree } from "./doc-tree";
  import DocTree from "./DocTree.svelte";

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
  const expandedProjects = writable<Set<string>>(new Set());
  const expandedFolders = writable<Set<string>>(new Set());

  $: status = authStore?.status;

  function toggleProject(projectId: string): void {
    expandedProjects.update((s) => {
      const next = new Set(s);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function toggleFolder(scope: string, path: string): void {
    expandedFolders.update((s) => {
      const next = new Set(s);
      const key = `${scope}::${path}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function scopedExpanded(all: Set<string>, scope: string): Set<string> {
    const out = new Set<string>();
    const prefix = `${scope}::`;
    for (const k of all) {
      if (k.startsWith(prefix)) out.add(k.slice(prefix.length));
    }
    return out;
  }

  function docPath(doc: DocSummary): string {
    return doc.folder_path ? `${doc.folder_path}/${doc.title}` : doc.title;
  }

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
          openPreviewSplit: (path) =>
            api.openPreviewSplit(path, { ratio: 1 / 3, exclusive: true }),
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
      // Expand the first project by default so users see something
      // immediately without having to click in.
      if ($status.projects.indexOf(p) === 0) {
        expandedProjects.update((s) =>
          s.has(p.id) ? s : new Set([...s, p.id]),
        );
      }
    }
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
        {@const open = $expandedProjects.has(project.id)}
        {@const tree = entry?.docs
          ? buildDocTree(entry.docs.map((d) => ({ path: docPath(d), data: d })))
          : []}
        <li>
          <button
            type="button"
            class="project-row"
            style="color: {$theme.fg};"
            on:click={() => toggleProject(project.id)}
            aria-expanded={open}
          >
            <svg
              class="chevron"
              class:open
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden="true"
              style="color: {$theme.fgMuted};"
            >
              <polyline
                points="3,1 7,5 3,9"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="project-name">{project.name}</span>
          </button>
          {#if open}
            {#if !entry || entry.loading}
              <p class="state indent" style="color: {$theme.fgMuted};">
                Loading…
              </p>
            {:else if entry.error}
              <p class="state indent" style="color: {$theme.danger};">
                {entry.error}
              </p>
            {:else if entry.docs && entry.docs.length === 0}
              <p class="state indent" style="color: {$theme.fgMuted};">
                No docs.
              </p>
            {:else if entry.docs}
              <div class="tree-wrap">
                <DocTree
                  nodes={tree}
                  expanded={scopedExpanded($expandedFolders, project.id)}
                  onToggle={(p) => toggleFolder(project.id, p)}
                  folderColor={$theme.fg}
                  chevronColor={$theme.fgMuted}
                >
                  {#snippet leaf({ node })}
                    <button
                      type="button"
                      class="leaf-btn"
                      style="color: {$theme.accent};"
                      on:click={() => openDoc(project.id, node.data)}
                    >
                      {node.name}
                    </button>
                  {/snippet}
                </DocTree>
              </div>
            {/if}
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
  p {
    margin: 0;
  }
  .state {
    font-size: 12px;
  }
  .indent {
    padding-left: 16px;
    padding-top: 2px;
  }
  .projects {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .projects > li {
    margin-bottom: 6px;
  }
  .project-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: none;
    border: 0;
    padding: 4px 0;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .project-row:hover .project-name {
    text-decoration: underline;
  }
  .chevron {
    flex-shrink: 0;
    transition: transform 0.12s ease-out;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .project-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tree-wrap {
    padding-left: 16px;
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
  .error {
    margin-top: 12px;
    font-size: 12px;
  }
</style>
