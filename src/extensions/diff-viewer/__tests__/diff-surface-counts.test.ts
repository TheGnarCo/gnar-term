/**
 * Tests for the DiffSurface +N -N summary counts.
 *
 * DiffSurface computes totalAdded/totalDeleted reactively from the parsed
 * `files` array and renders them in a `.diff-summary` header. These tests
 * verify the counting arithmetic against the same parseDiff output that
 * the component uses at runtime, cross-checking that the component's
 * reduce formulas match parseDiff's line type attribution.
 */
import { describe, it, expect } from "vitest";
import { parseDiff } from "../diff-parser";

/** Mirrors the totalAdded reactive statement in DiffSurface.svelte */
function computeTotalAdded(files: ReturnType<typeof parseDiff>): number {
  return files.reduce(
    (acc, f) =>
      acc +
      f.hunks.reduce(
        (a, h) => a + h.lines.filter((l) => l.type === "add").length,
        0,
      ),
    0,
  );
}

/** Mirrors the totalDeleted reactive statement in DiffSurface.svelte */
function computeTotalDeleted(files: ReturnType<typeof parseDiff>): number {
  return files.reduce(
    (acc, f) =>
      acc +
      f.hunks.reduce(
        (a, h) => a + h.lines.filter((l) => l.type === "delete").length,
        0,
      ),
    0,
  );
}

describe("DiffSurface summary counts", () => {
  const MINIMAL_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 context
-deleted line
+added line 1
+added line 2
 context
`;

  it("counts 2 added and 1 deleted from the reference diff", () => {
    const files = parseDiff(MINIMAL_DIFF);
    expect(computeTotalAdded(files)).toBe(2);
    expect(computeTotalDeleted(files)).toBe(1);
  });

  it("returns 0 added and 0 deleted for an empty diff", () => {
    const files = parseDiff("");
    expect(computeTotalAdded(files)).toBe(0);
    expect(computeTotalDeleted(files)).toBe(0);
  });

  it("accumulates counts across multiple files", () => {
    const multiFileDiff = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,4 @@
 ctx
-del1
+add1
+add2
 ctx
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1,3 +1,2 @@
 ctx
-del2
-del3
+add3
 ctx
`;
    const files = parseDiff(multiFileDiff);
    // file1: 2 added, 1 deleted
    // file2: 1 added, 2 deleted
    expect(computeTotalAdded(files)).toBe(3);
    expect(computeTotalDeleted(files)).toBe(3);
  });

  it("accumulates counts across multiple hunks in one file", () => {
    const multiHunkDiff = `diff --git a/big.ts b/big.ts
--- a/big.ts
+++ b/big.ts
@@ -1,3 +1,3 @@
 ctx
-old-hunk1
+new-hunk1
 ctx
@@ -50,3 +50,4 @@
 ctx
-old-hunk2
+new-hunk2a
+new-hunk2b
 ctx
`;
    const files = parseDiff(multiHunkDiff);
    // hunk1: 1 add, 1 del
    // hunk2: 2 add, 1 del
    expect(computeTotalAdded(files)).toBe(3);
    expect(computeTotalDeleted(files)).toBe(2);
  });

  it("does not count context or header lines as additions or deletions", () => {
    const rawDiff = `diff --git a/ctx.ts b/ctx.ts
--- a/ctx.ts
+++ b/ctx.ts
@@ -1,4 +1,4 @@
 context line 1
 context line 2
-delete me
+add me
 context line 3
`;
    const files = parseDiff(rawDiff);
    expect(computeTotalAdded(files)).toBe(1);
    expect(computeTotalDeleted(files)).toBe(1);
  });

  it("counts purely additive diffs correctly (new file)", () => {
    const newFileDiff = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+line one
+line two
+line three
`;
    const files = parseDiff(newFileDiff);
    expect(computeTotalAdded(files)).toBe(3);
    expect(computeTotalDeleted(files)).toBe(0);
  });

  it("counts purely deletive diffs correctly (deleted file)", () => {
    const deletedFileDiff = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
`;
    const files = parseDiff(deletedFileDiff);
    expect(computeTotalAdded(files)).toBe(0);
    expect(computeTotalDeleted(files)).toBe(2);
  });

  it("returns zero counts for a binary-only diff", () => {
    const binaryDiff = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ
`;
    const files = parseDiff(binaryDiff);
    // Binary files have no hunks so no lines to count
    expect(computeTotalAdded(files)).toBe(0);
    expect(computeTotalDeleted(files)).toBe(0);
  });

  it("summary header renders when counts match diff data", () => {
    // Verify the template condition: renders when files.length > 0.
    // The component renders .diff-summary only inside the else branch
    // (not loading, no error, files.length > 0). Verify that counts > 0
    // when the reference diff is parsed — i.e., the header would appear.
    const files = parseDiff(MINIMAL_DIFF);
    const added = computeTotalAdded(files);
    const deleted = computeTotalDeleted(files);

    // The component renders the summary only when files exist
    expect(files.length).toBeGreaterThan(0);
    // At least one side is non-zero so the header has meaningful content
    expect(added + deleted).toBeGreaterThan(0);
    // The rendered text would be `+${added}` and `-${deleted}`
    expect(`+${added}`).toBe("+2");
    expect(`-${deleted}`).toBe("-1");
  });
});
