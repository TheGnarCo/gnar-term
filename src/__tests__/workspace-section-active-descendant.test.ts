/**
 * Regression test: in collapsed mode the workspace's left rail must be
 * full-width whenever ANY descendant is the active workspace — not only
 * when the root/primary workspace itself is selected.
 *
 * The bug: WorkspaceSectionContent used to forward
 *   hasActiveChild={isPrimaryActive}
 * which meant a branched workspace or dashboard child being active left
 * the rail in its narrow inactive width (4px). The fix introduces a
 * dedicated `hasActiveDescendant` derivation that covers the root, every
 * branched workspace, and every dashboard child of the workspace.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const SOURCE = readFileSync(
  "src/lib/components/WorkspaceSectionContent.svelte",
  "utf-8",
);

describe("WorkspaceSectionContent — collapsed rail tracks any descendant", () => {
  it("derives hasActiveDescendant from root id + any rootWorkspaceId match", () => {
    expect(SOURCE).toContain("hasActiveDescendant");
    expect(SOURCE).toMatch(
      /active\.id === workspace\.id \|\| active\.rootWorkspaceId === workspace\.id/,
    );
  });

  it("forwards hasActiveDescendant (not isPrimaryActive) to ContainerRow", () => {
    expect(SOURCE).toContain("hasActiveChild={hasActiveDescendant}");
    expect(SOURCE).not.toContain("hasActiveChild={isPrimaryActive}");
  });
});
