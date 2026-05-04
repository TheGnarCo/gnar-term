/**
 * Regression test for the rename-era root-row bootstrap bug.
 *
 * `App.svelte` builds `extensionRows` from the live rootRowOrder so it can
 * call `bootstrapRootRowOrder(nestedIds, extensionRows)`. The intent is to
 * pass through every non-nested-workspace row (umbrella workspaces, agent
 * dashboards, pseudo-workspaces). Pre-rename, the kind that meant "nested"
 * was literally `"workspace"`, so the filter read `kind !== "workspace"`.
 *
 * After the umbrella rename (Workspace→NestedWorkspace, Group→Workspace),
 * `kind: "workspace"` flipped meaning to umbrella. A leftover
 * `kind !== "workspace"` filter would silently drop persisted umbrella rows
 * on every reload — workspaces would render in the main pane (because the
 * nested-workspace store hydrates independently) but the primary sidebar
 * would show no rows for the umbrellas.
 *
 * This test source-scans `App.svelte` to make sure the filter excludes
 * `"nested-workspace"`, not the umbrella `"workspace"` kind.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const APP = readFileSync("src/App.svelte", "utf-8");

describe("App.svelte rootRowOrder bootstrap filter", () => {
  it("filters extensionRows by `kind !== 'nested-workspace'`, not the umbrella kind", () => {
    const oneLine = APP.replace(/\s+/g, " ");
    // Match the filter callsite up to the kind comparison. The `(r) =>`
    // arrow contains its own parens, so use a broader gap matcher rather
    // than `[^)]*`.
    expect(oneLine).toMatch(
      /extensionRows\s*=\s*currentOrder\.filter\([^{]*?r\.kind\s*!==\s*"nested-workspace"/,
    );
    expect(oneLine).not.toMatch(
      /extensionRows\s*=\s*currentOrder\.filter\([^{]*?r\.kind\s*!==\s*"workspace"(?!-)/,
    );
  });
});
