/**
 * Pure unified diff parser.
 *
 * Parses raw `git diff` output into structured data suitable for rendering.
 * Zero dependencies — easy to unit test in isolation.
 */

export interface DiffLine {
  type: "add" | "delete" | "context" | "header";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
}

// eslint-disable-next-line security/detect-unsafe-regex -- anchored diff header regex with bounded quantifiers, no backtracking risk
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunkHeader(line: string): Omit<DiffHunk, "lines"> | null {
  const m = HUNK_HEADER_RE.exec(line);
  if (!m) return null;
  return {
    header: line,
    oldStart: parseInt(m[1]!, 10),
    oldCount: m[2] !== undefined ? parseInt(m[2], 10) : 1,
    newStart: parseInt(m[3]!, 10),
    newCount: m[4] !== undefined ? parseInt(m[4], 10) : 1,
  };
}

function stripPath(raw: string): string {
  // "a/src/foo.ts" -> "src/foo.ts", "/dev/null" stays as-is.
  // Also handles `i/`/`w/` (index/work-tree) prefixes when the user has
  // `diff.mnemonicPrefix = true` configured, and `c/`/`o/` for the less
  // common cached/other mnemonic pairs.
  if (raw === "/dev/null") return raw;
  return raw.replace(/^[abiwco]\//, "");
}

export function parseDiff(rawDiff: string): DiffFile[] {
  if (!rawDiff || !rawDiff.trim()) return [];

  const lines = rawDiff.split("\n");
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // New file header
    if (line.startsWith("diff --git ")) {
      // Finalize previous hunk/file
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk);
      }
      currentHunk = null;

      currentFile = {
        oldPath: "",
        newPath: "",
        hunks: [],
        isNew: false,
        isDeleted: false,
        isBinary: false,
      };
      files.push(currentFile);

      // Extract paths from "diff --git a/path b/path"
      const parts = line.slice("diff --git ".length);
      const spaceIdx = findGitDiffPathSplit(parts);
      if (spaceIdx !== -1) {
        currentFile.oldPath = stripPath(parts.slice(0, spaceIdx));
        currentFile.newPath = stripPath(parts.slice(spaceIdx + 1));
      }
      continue;
    }

    if (!currentFile) continue;

    // Metadata lines
    if (line.startsWith("new file mode")) {
      currentFile.isNew = true;
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      currentFile.isDeleted = true;
      continue;
    }
    if (line.startsWith("Binary files") && line.includes("differ")) {
      currentFile.isBinary = true;
      continue;
    }

    // Old/new path headers (override the diff --git line values)
    if (line.startsWith("--- ")) {
      currentFile.oldPath = stripPath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      currentFile.newPath = stripPath(line.slice(4));
      continue;
    }

    // Hunk header
    const hunkInfo = parseHunkHeader(line);
    if (hunkInfo) {
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      currentHunk = { ...hunkInfo, lines: [] };
      oldLine = hunkInfo.oldStart;
      newLine = hunkInfo.newStart;
      currentHunk.lines.push({
        type: "header" as const,
        content: line,
      });
      continue;
    }

    // Diff content lines (only inside a hunk)
    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        newLineNum: newLine,
      });
      newLine++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "delete",
        content: line.slice(1),
        oldLineNum: oldLine,
      });
      oldLine++;
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNum: oldLine,
        newLineNum: newLine,
      });
      oldLine++;
      newLine++;
    }
    // Skip "\ No newline at end of file" and other non-standard lines
  }

  // Finalize last hunk/file
  if (currentHunk && currentFile) {
    currentFile.hunks.push(currentHunk);
  }

  return files;
}

/**
 * Find the split point between the two paths in "<prefix>/path <prefix>/path".
 * Git paths can contain spaces, so we look for the second-prefix separator.
 * Standard diffs use `a/` / `b/`; `diff.mnemonicPrefix = true` swaps to
 * `i/`/`w/`, `c/`/`w/`, or `o/`/`w/` depending on the operation.
 */
function findGitDiffPathSplit(combined: string): number {
  for (const marker of [" b/", " w/", " c/", " o/", " i/"]) {
    const idx = combined.indexOf(marker);
    if (idx !== -1) return idx;
  }
  // Fallback for /dev/null cases
  const nullIdx = combined.indexOf(" /dev/null");
  if (nullIdx !== -1) return nullIdx;
  // Last resort: first space
  return combined.indexOf(" ");
}
