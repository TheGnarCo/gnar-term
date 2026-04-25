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
  /**
   * Pane-level visibility flag forwarded by `PaneView`. Sibling surfaces in
   * the same pane stay mounted at once; each surface hides itself when it
   * isn't the active one. Defaults to true so standalone renders (tests,
   * future embeddings) don't collapse.
   */
  export let visible: boolean = true;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  const MAX_LINES = 5000;

  let files: DiffFile[] = [];
  let loading = true;
  let error: string | null = null;
  let truncated = false;
  let collapsedFiles: Set<number> = new Set();

  $: totalAdded = files.reduce(
    (acc, f) =>
      acc +
      f.hunks.reduce(
        (a, h) => a + h.lines.filter((l) => l.type === "add").length,
        0,
      ),
    0,
  );
  $: totalDeleted = files.reduce(
    (acc, f) =>
      acc +
      f.hunks.reduce(
        (a, h) => a + h.lines.filter((l) => l.type === "delete").length,
        0,
      ),
    0,
  );

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

  /**
   * List the repo's untracked files via porcelain and synthesize diff
   * entries that render each as a "new file" body. Tauri has no raw
   * "read untracked as diff" command, so we use git_status to get the
   * paths and read_file to pull the content — clamped to 2KB per file
   * so huge untracked blobs don't wedge the viewer.
   */
  const UNTRACKED_PREVIEW_BYTES = 2048;
  async function collectUntrackedAsDiff(repo: string): Promise<DiffFile[]> {
    try {
      const list = await api.invoke<
        Array<{ path: string; status: string; staged: string }>
      >("git_status", { repoPath: repo });
      const untracked = list.filter(
        (f) => (f.status ?? "") + (f.staged ?? "") === "??",
      );
      const out: DiffFile[] = [];
      for (const f of untracked) {
        let text = "";
        try {
          text = await api.invoke<string>("read_file", {
            path: `${repo}/${f.path}`,
          });
          if (text.length > UNTRACKED_PREVIEW_BYTES) {
            text = text.slice(0, UNTRACKED_PREVIEW_BYTES) + "\n… (truncated)";
          }
        } catch {
          text = "(unreadable)";
        }
        const lines: DiffLine[] = [
          {
            type: "header",
            content: `@@ -0,0 +1,${text.split("\n").length} @@`,
          },
          ...text.split("\n").map((line, i) => ({
            type: "add" as const,
            content: line,
            newLineNum: i + 1,
          })),
        ];
        out.push({
          oldPath: "/dev/null",
          newPath: f.path,
          hunks: [
            {
              header: `@@ -0,0 +1,${lines.length - 1} @@`,
              oldStart: 0,
              oldCount: 0,
              newStart: 1,
              newCount: lines.length - 1,
              lines,
            },
          ],
          isNew: true,
          isDeleted: false,
          isBinary: false,
        });
      }
      return out;
    } catch {
      return [];
    }
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

      // Default to "everything uncommitted" when the caller supplied no
      // comparison — plain `git diff` only surfaces unstaged edits, so a
      // tree whose changes are all staged (or untracked) showed up as
      // "No changes" here even though `git status` listed them. Passing
      // base=HEAD folds staged + unstaged into a single diff.
      if (!filePath && !baseBranch && !compareBranch && !staged && !args.base) {
        args.base = "HEAD";
      }

      const rawDiff = await api.invoke<string>("git_diff", args);
      let parsed = parseDiff(rawDiff);

      // Untracked files still aren't part of a `git diff HEAD` because
      // git has no pre-image to diff against. Fold them in as
      // synthetic "new file" hunks so the Uncommitted Changes surface
      // actually shows every dirty file the sidebar counted.
      if (!filePath && !baseBranch && !compareBranch && !staged) {
        const untracked = await collectUntrackedAsDiff(repo);
        if (untracked.length > 0) parsed = [...parsed, ...untracked];
      }

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

<div
  class="diff-surface"
  style:background={$theme.bg}
  style:color={$theme.fg}
  style:display={visible ? "block" : "none"}
>
  {#if loading}
    <div class="diff-message" style:color={$theme.fgDim}>Loading diff...</div>
  {:else if error}
    <div class="diff-message diff-error" style:color="#f44">Error: {error}</div>
  {:else if files.length === 0}
    <div class="diff-message" style:color={$theme.fgDim}>No changes</div>
  {:else}
    <div
      class="diff-summary"
      style:color={$theme.fgDim}
      style:border-color={$theme.border}
    >
      <span class="diff-summary-added">+{totalAdded}</span>
      <span class="diff-summary-deleted">-{totalDeleted}</span>
    </div>
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
    /* Match TerminalSurface / PreviewSurface: occupy the remaining pane
       height via flex sizing (the pane is flex-direction: column).
       height: 100% alone collapses to 0 inside a flex child without a
       grow hint, which showed up as a fully blank surface. */
    flex: 1;
    min-width: 0;
    min-height: 0;
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

  .diff-summary {
    display: flex;
    gap: 10px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    border-bottom: 1px solid;
  }

  .diff-summary-added {
    color: #4ec957;
  }

  .diff-summary-deleted {
    color: #e85454;
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
