/**
 * Tests for the pure unified diff parser.
 * No mocks needed — parseDiff is a pure function with zero dependencies.
 */
import { describe, it, expect } from "vitest";
import { parseDiff } from "../diff-parser";

describe("parseDiff", () => {
  it("returns empty array for empty string", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(parseDiff("   \n  \n")).toEqual([]);
  });

  it("parses a single file with one hunk", () => {
    const raw = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index abc123..def456 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,4 @@",
      " line one",
      " line two",
      "+line three",
      " line four",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].oldPath).toBe("src/foo.ts");
    expect(result[0].newPath).toBe("src/foo.ts");
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].isNew).toBe(false);
    expect(result[0].isDeleted).toBe(false);
    expect(result[0].isBinary).toBe(false);

    const hunk = result[0].hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(4);
    // header + 3 context + 1 add = 5 lines
    expect(hunk.lines).toHaveLength(5);
  });

  it("parses a multi-file diff", () => {
    const raw = [
      "diff --git a/file1.ts b/file1.ts",
      "--- a/file1.ts",
      "+++ b/file1.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " same",
      "diff --git a/file2.ts b/file2.ts",
      "--- a/file2.ts",
      "+++ b/file2.ts",
      "@@ -1,1 +1,1 @@",
      "-removed",
      "+added",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(2);
    expect(result[0].newPath).toBe("file1.ts");
    expect(result[1].newPath).toBe("file2.ts");
  });

  it("tracks line numbers correctly through context/add/delete", () => {
    const raw = [
      "diff --git a/test.ts b/test.ts",
      "--- a/test.ts",
      "+++ b/test.ts",
      "@@ -10,6 +10,7 @@",
      " context line",
      "-deleted line",
      "+added line 1",
      "+added line 2",
      " another context",
      " last context",
    ].join("\n");

    const result = parseDiff(raw);
    const lines = result[0].hunks[0].lines;

    // Header line
    expect(lines[0].type).toBe("header");

    // Context: old=10, new=10
    expect(lines[1].type).toBe("context");
    expect(lines[1].oldLineNum).toBe(10);
    expect(lines[1].newLineNum).toBe(10);

    // Delete: old=11 (new not set)
    expect(lines[2].type).toBe("delete");
    expect(lines[2].oldLineNum).toBe(11);
    expect(lines[2].newLineNum).toBeUndefined();

    // Add 1: new=11 (old not set)
    expect(lines[3].type).toBe("add");
    expect(lines[3].newLineNum).toBe(11);
    expect(lines[3].oldLineNum).toBeUndefined();

    // Add 2: new=12
    expect(lines[4].type).toBe("add");
    expect(lines[4].newLineNum).toBe(12);

    // Context: old=12, new=13
    expect(lines[5].type).toBe("context");
    expect(lines[5].oldLineNum).toBe(12);
    expect(lines[5].newLineNum).toBe(13);

    // Context: old=13, new=14
    expect(lines[6].type).toBe("context");
    expect(lines[6].oldLineNum).toBe(13);
    expect(lines[6].newLineNum).toBe(14);
  });

  it("detects new file mode", () => {
    const raw = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "index 0000000..abc1234",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,2 @@",
      "+first line",
      "+second line",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].isNew).toBe(true);
    expect(result[0].isDeleted).toBe(false);
    expect(result[0].newPath).toBe("new.ts");
  });

  it("detects deleted file mode", () => {
    const raw = [
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "index abc1234..0000000",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-first line",
      "-second line",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].isDeleted).toBe(true);
    expect(result[0].isNew).toBe(false);
    expect(result[0].oldPath).toBe("old.ts");
  });

  it("detects binary files", () => {
    const raw = [
      "diff --git a/image.png b/image.png",
      "Binary files a/image.png and b/image.png differ",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].isBinary).toBe(true);
    expect(result[0].hunks).toHaveLength(0);
  });

  it("parses hunk header numbers correctly", () => {
    const raw = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -42,10 +55,8 @@ function foo() {",
      " context",
    ].join("\n");

    const result = parseDiff(raw);
    const hunk = result[0].hunks[0];
    expect(hunk.oldStart).toBe(42);
    expect(hunk.oldCount).toBe(10);
    expect(hunk.newStart).toBe(55);
    expect(hunk.newCount).toBe(8);
    expect(hunk.header).toContain("@@ -42,10 +55,8 @@");
  });

  it("parses hunk header with single-line counts (no comma)", () => {
    const raw = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const result = parseDiff(raw);
    const hunk = result[0].hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(1);
  });

  it("handles multiple hunks in one file", () => {
    const raw = [
      "diff --git a/big.ts b/big.ts",
      "--- a/big.ts",
      "+++ b/big.ts",
      "@@ -1,3 +1,3 @@",
      " first",
      "-old second",
      "+new second",
      " third",
      "@@ -50,3 +50,4 @@",
      " fifty",
      " fifty-one",
      "+inserted",
      " fifty-two",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);
    expect(result[0].hunks[0].oldStart).toBe(1);
    expect(result[0].hunks[1].oldStart).toBe(50);
  });

  it("handles lines with special characters", () => {
    const raw = [
      "diff --git a/special.ts b/special.ts",
      "--- a/special.ts",
      "+++ b/special.ts",
      "@@ -1,3 +1,3 @@",
      " const x = `template ${var}`;",
      '-const y = "quotes \\"escaped\\"";',
      '+const y = "quotes \\"new\\"";',
      " const z = /regex+/g;",
    ].join("\n");

    const result = parseDiff(raw);
    const lines = result[0].hunks[0].lines;
    // header + 2 context + 1 delete + 1 add = 5
    expect(lines).toHaveLength(5);
    expect(lines[1].content).toBe("const x = `template ${var}`;");
    expect(lines[2].content).toBe('const y = "quotes \\"escaped\\"";');
    expect(lines[3].content).toBe('const y = "quotes \\"new\\"";');
  });

  it("strips i/ and w/ prefixes when diff.mnemonicPrefix is enabled", () => {
    const raw = [
      "diff --git i/src/foo.ts w/src/foo.ts",
      "index abc..def 100644",
      "--- i/src/foo.ts",
      "+++ w/src/foo.ts",
      "@@ -1,2 +1,3 @@",
      " keep",
      "-old",
      "+new",
      "+added",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].oldPath).toBe("src/foo.ts");
    expect(result[0].newPath).toBe("src/foo.ts");
    expect(result[0].hunks).toHaveLength(1);
  });

  it("strips c/ and o/ mnemonic prefixes for cached/other diffs", () => {
    const raw = [
      "diff --git c/src/bar.ts w/src/bar.ts",
      "--- c/src/bar.ts",
      "+++ w/src/bar.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].oldPath).toBe("src/bar.ts");
    expect(result[0].newPath).toBe("src/bar.ts");
  });
});
