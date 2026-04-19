<script lang="ts">
  import { onMount } from "svelte";
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import { parseDiff, type DiffFile, type DiffLine } from "./diff-parser";

  /** Props passed via api.openSurface(). */
  export let filePath: string | undefined = undefined;
  export let baseBranch: string | undefined = undefined;
  export let compareBranch: string | undefined = undefined;
  export let repoPath: string | undefined = undefined;
  export let staged: boolean | undefined = undefined;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  const MAX_LINES = 5000;

  let files: DiffFile[] = [];
  let loading = true;
  let error: string | null = null;
  let truncated = false;
  let collapsedFiles: Set<number> = new Set();

  function toggleFile(index: number): void {
    if (collapsedFiles.has(index)) {
      collapsedFiles.delete(index);
    } else {
      collapsedFiles.add(index);
    }
    collapsedFiles = collapsedFiles; // trigger reactivity
  }

  function countTotalLines(parsed: DiffFile[]): number {
    let total = 0;
    for (const file of parsed) {
      for (const hunk of file.hunks) {
        total += hunk.lines.length;
      }
    }
    return total;
  }

  function truncateFiles(parsed: DiffFile[]): DiffFile[] {
    let remaining = MAX_LINES;
    const result: DiffFile[] = [];
    for (const file of parsed) {
      if (remaining <= 0) break;
      const truncatedHunks = [];
      for (const hunk of file.hunks) {
        if (remaining <= 0) break;
        if (hunk.lines.length <= remaining) {
          truncatedHunks.push(hunk);
          remaining -= hunk.lines.length;
        } else {
          truncatedHunks.push({
            ...hunk,
            lines: hunk.lines.slice(0, remaining),
          });
          remaining = 0;
        }
      }
      result.push({ ...file, hunks: truncatedHunks });
    }
    return result;
  }

  function lineClass(type: DiffLine["type"]): string {
    switch (type) {
      case "add":
        return "diff-line-add";
      case "delete":
        return "diff-line-delete";
      case "header":
        return "diff-line-header";
      default:
        return "diff-line-context";
    }
  }

  onMount(async () => {
    try {
      const repo = repoPath ?? (await api.getActiveCwd());
      if (!repo) {
        error = "No repository path available";
        loading = false;
        return;
      }

      const args: Record<string, unknown> = { repoPath: repo };
      if (filePath) args.file = filePath;
      if (baseBranch) args.base = baseBranch;
      if (compareBranch) args.head = compareBranch;
      if (staged) args.staged = true;

      const rawDiff = await api.invoke<string>("git_diff", args);
      const parsed = parseDiff(rawDiff);

      if (countTotalLines(parsed) > MAX_LINES) {
        files = truncateFiles(parsed);
        truncated = true;
      } else {
        files = parsed;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="diff-surface" style:background={$theme.bg} style:color={$theme.fg}>
  {#if loading}
    <div class="diff-message" style:color={$theme.fgDim}>Loading diff...</div>
  {:else if error}
    <div class="diff-message diff-error" style:color="#f44">Error: {error}</div>
  {:else if files.length === 0}
    <div class="diff-message" style:color={$theme.fgDim}>No changes</div>
  {:else}
    <div class="diff-content">
      {#each files as file, fileIdx}
        <div class="diff-file" style:border-color={$theme.border}>
          <button
            class="diff-file-header"
            style:background="{$theme.border}44"
            style:color={$theme.fg}
            on:click={() => toggleFile(fileIdx)}
          >
            <span class="collapse-indicator"
              >{collapsedFiles.has(fileIdx) ? "\u25B6" : "\u25BC"}</span
            >
            <span class="file-path">
              {file.newPath || file.oldPath}
              {#if file.isNew}
                <span class="file-badge" style:color={$theme.accent}>(new)</span
                >
              {/if}
              {#if file.isDeleted}
                <span class="file-badge" style:color="#f44">(deleted)</span>
              {/if}
              {#if file.isBinary}
                <span class="file-badge" style:color={$theme.fgDim}
                  >(binary)</span
                >
              {/if}
            </span>
          </button>

          {#if !collapsedFiles.has(fileIdx)}
            {#if file.isBinary}
              <div class="diff-binary" style:color={$theme.fgDim}>
                Binary file differs
              </div>
            {:else}
              {#each file.hunks as hunk}
                <div class="diff-hunk">
                  {#each hunk.lines as line}
                    <div class="diff-line {lineClass(line.type)}">
                      <span class="line-num old" style:color={$theme.fgDim}>
                        {line.oldLineNum ?? ""}
                      </span>
                      <span class="line-num new" style:color={$theme.fgDim}>
                        {line.newLineNum ?? ""}
                      </span>
                      <span class="line-content">{line.content}</span>
                    </div>
                  {/each}
                </div>
              {/each}
            {/if}
          {/if}
        </div>
      {/each}

      {#if truncated}
        <div class="diff-truncated" style:color={$theme.fgDim}>
          Diff truncated — showing first {MAX_LINES} lines
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .diff-surface {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 12px;
    line-height: 1.5;
  }

  .diff-message {
    padding: 24px;
    text-align: center;
    font-size: 13px;
  }

  .diff-content {
    padding: 8px;
  }

  .diff-file {
    margin-bottom: 12px;
    border: 1px solid;
    border-radius: 4px;
    overflow: hidden;
  }

  .diff-file-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    text-align: left;
  }

  .diff-file-header:hover {
    opacity: 0.85;
  }

  .collapse-indicator {
    font-size: 10px;
    flex-shrink: 0;
    width: 12px;
  }

  .file-path {
    font-weight: 600;
  }

  .file-badge {
    font-weight: 400;
    font-size: 11px;
    margin-left: 6px;
  }

  .diff-binary {
    padding: 12px 16px;
    font-style: italic;
  }

  .diff-hunk {
    border-top: 1px solid rgba(128, 128, 128, 0.15);
  }

  .diff-line {
    display: flex;
    white-space: pre;
  }

  .diff-line-add {
    background: rgba(40, 167, 69, 0.15);
  }

  .diff-line-delete {
    background: rgba(220, 53, 69, 0.15);
  }

  .diff-line-header {
    font-weight: 600;
    opacity: 0.7;
    background: rgba(128, 128, 128, 0.08);
  }

  .diff-line-context {
    background: transparent;
  }

  .line-num {
    display: inline-block;
    width: 48px;
    min-width: 48px;
    text-align: right;
    padding: 0 6px;
    user-select: none;
    flex-shrink: 0;
    border-right: 1px solid rgba(128, 128, 128, 0.15);
  }

  .line-num.old {
    border-right: none;
  }

  .line-content {
    padding-left: 8px;
    flex: 1;
    min-width: 0;
  }

  .diff-truncated {
    padding: 12px;
    text-align: center;
    font-style: italic;
    border-top: 1px dashed rgba(128, 128, 128, 0.3);
    margin-top: 8px;
  }
</style>
