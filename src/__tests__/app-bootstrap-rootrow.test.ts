/**
 * Regression test for the rename-era root-row bootstrap bug.
 *
 * `App.svelte` builds `extensionRows` from the live rootRowOrder so it can
 * call `bootstrapRootRowOrder(branchedIds, extensionRows)`. The intent is to
 * pass through every non-child-workspace row (parent workspaces, agent
 * dashboards, pseudo-workspaces). The kind for child workspaces is
 * `"child-workspace"`, distinct from the parent kind `"workspace"`.
 *
 * This test source-scans `App.svelte` to make sure the filter excludes
 * `"child-workspace"`, not the parent `"workspace"` kind.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const APP = readFileSync("src/App.svelte", "utf-8");

describe("App.svelte rootRowOrder bootstrap filter", () => {
  it("filters extensionRows by `kind !== 'child-workspace'`, not the parent kind", () => {
    const oneLine = APP.replace(/\s+/g, " ");
    // Match the filter callsite up to the kind comparison. The `(r) =>`
    // arrow contains its own parens, so use a broader gap matcher rather
    // than `[^)]*`.
    expect(oneLine).toMatch(
      /extensionRows\s*=\s*currentOrder\.filter\([^{]*?r\.kind\s*!==\s*"child-workspace"/,
    );
    expect(oneLine).not.toMatch(
      /extensionRows\s*=\s*currentOrder\.filter\([^{]*?r\.kind\s*!==\s*"workspace"(?!-)/,
    );
  });
});
