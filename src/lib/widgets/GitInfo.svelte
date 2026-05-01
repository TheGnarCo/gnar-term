<script lang="ts">
  /**
   * `gnar:git-info` — compact git status summary for the enclosing
   * Workspace's repo path. Shows current branch, dirty-file
   * count, and a "Browse on GitHub" link when the origin remote is a
   * recognizable HTTP(S) URL.
   *
   * Scope comes from the enclosing `DashboardHostContext` (spec §5.3):
   *   - workspace scope  → uses `workspace.path` as the repo to inspect
   *   - global scope → widget takes `repoPath` as an explicit config
   *   - none         → widget is inert
   */
  import { getContext, onDestroy, onMount } from "svelte";
  import { theme } from "../stores/theme";
  import { getWorkspace } from "../stores/workspaces";
  import {
    deriveDashboardScope,
    getDashboardHost,
  } from "../contexts/dashboard-host";
  import { EXTENSION_API_KEY } from "../extension-types";
  import type { ExtensionAPI } from "../extension-types";

  interface BranchInfo {
    name: string;
    is_current: boolean;
  }
  interface FileStatus {
    path: string;
    status: string;
    staged: string;
  }

  /** Explicit repo override — required under global scope. */
  export let repoPath: string | undefined = undefined;

  const REFRESH_MS = 30_000;

  const maybeApi = getContext<ExtensionAPI | undefined>(EXTENSION_API_KEY);

  async function callCmd<T>(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    if (maybeApi) return maybeApi.invoke<T>(cmd, args);
    const core = await import("@tauri-apps/api/core");
    return core.invoke<T>(cmd, args);
  }

  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);

  function resolveRepoPath(): string | null {
    if (scope.kind === "workspace") {
      const g = getWorkspace(scope.parentWorkspaceId);
      return g?.path ?? null;
    }
    if (scope.kind === "global") {
      return repoPath?.trim() || null;
    }
    return null;
  }

  let branch: string | null = null;
  let dirtyCount = 0;
  let remoteUrl = "";
  let webUrl = "";
  let errored = false;
  let loading = true;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  function sshToHttps(url: string): string {
    const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(url);
    if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
    return url.replace(/\.git$/, "");
  }

  async function refresh(): Promise<void> {
    const path = resolveRepoPath();
    if (!path) {
      errored = true;
      loading = false;
      return;
    }
    errored = false;
    loading = true;
    try {
      const [branches, status, remote] = await Promise.all([
        callCmd<BranchInfo[]>("list_branches", {
          repoPath: path,
          includeRemote: false,
        }),
        callCmd<FileStatus[]>("git_status", { repoPath: path }),
        callCmd<string>("git_remote_url", { repoPath: path }),
      ]);
      branch = branches.find((b) => b.is_current)?.name ?? null;
      dirtyCount = status.length;
      remoteUrl = remote ?? "";
      webUrl = remoteUrl ? sshToHttps(remoteUrl) : "";
    } catch {
      errored = true;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
    refreshTimer = setInterval(() => void refresh(), REFRESH_MS);
  });
  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  $: dirtyLabel =
    dirtyCount === 0
      ? "clean"
      : `${dirtyCount} file${dirtyCount === 1 ? "" : "s"} modified`;
</script>

<div
  data-git-info
  data-scope-kind={scope.kind}
  style="
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px; border: 1px solid {$theme.border};
    border-radius: 6px; background: {$theme.bgSurface};
    font-size: 13px; color: {$theme.fg};
  "
>
  <div style="display: flex; align-items: center; gap: 8px; font-weight: 600;">
    <span
      aria-hidden="true"
      style="color: {$theme.fgDim}; font-family: monospace;">↳</span
    >
    <span>Git</span>
  </div>

  {#if scope.kind === "none"}
    <div data-git-info-no-scope style="color: {$theme.fgDim};">
      Mount inside a Workspace dashboard to see git status.
    </div>
  {:else if loading && !branch}
    <div style="color: {$theme.fgDim};">Loading…</div>
  {:else if errored}
    <div
      data-git-info-error
      style="color: {$theme.danger}; font-family: monospace; font-size: 12px;"
    >
      git unavailable for this repo
    </div>
  {:else}
    <div
      style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;"
    >
      <span
        data-git-info-branch
        style="
          font-family: monospace;
          padding: 2px 8px; border-radius: 4px;
          background: {$theme.bg}; border: 1px solid {$theme.border};
        ">{branch ?? "detached"}</span
      >
      <span
        data-git-info-dirty
        data-dirty-count={dirtyCount}
        style="color: {dirtyCount > 0
          ? ($theme.warning ?? $theme.fg)
          : $theme.fgDim};"
      >
        {dirtyLabel}
      </span>
      {#if webUrl}
        <a
          data-git-info-github
          href={webUrl}
          target="_blank"
          rel="noopener noreferrer"
          style="
            margin-left: auto;
            color: {$theme.accent};
            font-size: 12px;
          "
        >
          Browse on GitHub ↗
        </a>
      {/if}
    </div>
  {/if}
</div>
