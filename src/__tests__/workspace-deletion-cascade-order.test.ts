/**
 * Regression test for the parent workspace-deletion phantom-recreate bug.
 *
 * `setupPrimaryWorkspaceAutoRecreation` listens for `workspace:closed` and,
 * when the closed child workspace was an parent workspace's `primaryBranchedWorkspaceId`,
 * spawns a replacement primary child workspace. That listener is correct
 * for "user closed only the primary child workspace" — the parent workspace must
 * keep a primary at all times.
 *
 * It used to be wrong for the deletion + archive flows. Both flows
 * cascade-closed child workspaces BEFORE removing the parent workspace from the
 * workspaces store, so the listener saw an intact parent workspace, recreated the
 * primary, and only then did the parent workspace vanish — leaving the phantom
 * primary behind with a `parentWorkspaceId` pointing to a now-deleted
 * parent workspace. On reload `reconcilePrimaryWorkspaces` Pass 2 rewrapped the
 * orphan into a fresh parent workspace, so deletes appeared to "come back" with
 * a new identity each time and extras accumulated.
 *
 * The fix is to remove the parent workspace from the workspaces store first, so
 * the auto-recreate listener short-circuits. These source-scan assertions
 * pin the order at both call sites; archive-service.test.ts also asserts
 * the order behaviorally via mock invocation ordering.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("parent workspace deletion cascades close AFTER removing the parent workspace", () => {
  it("WorkspaceSectionContent.handleDeleteWorkspace calls deleteWorkspace before closeWorkspacesInWorkspace", () => {
    const src = read("src/lib/components/WorkspaceSectionContent.svelte");
    const handler = src.match(
      /async function handleDeleteWorkspace\(\)[\s\S]*?\n\s*\}\s*\n/,
    )?.[0];
    expect(handler).toBeDefined();
    const deleteIdx = handler!.indexOf("deleteWorkspace(w.id)");
    const closeIdx = handler!.indexOf("closeWorkspacesInWorkspace(w.id)");
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(closeIdx);
  });

  it("archive-service.archiveWorkspace removes the parent workspace from setWorkspaces before closeWorkspacesInWorkspace", () => {
    const src = read("src/lib/services/archive-service.ts");
    const fn = src.match(
      /export async function archiveWorkspace[\s\S]*?\n\}\s*\n/,
    )?.[0];
    expect(fn).toBeDefined();
    const setIdx = fn!.indexOf("setWorkspaces(getWorkspaces().filter");
    const closeIdx = fn!.indexOf("closeWorkspacesInWorkspace");
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeLessThan(closeIdx);
  });

  it("setupPrimaryWorkspaceAutoRecreation early-returns when no parent workspace claims the closed primary", () => {
    // The listener's safety net: even if a future caller forgets to
    // remove the parent workspace first, the listener must still defend against
    // recreating a primary for a workspace that doesn't exist.
    const src = read("src/lib/services/workspace-service.ts");
    const fn = src.match(
      /export function setupPrimaryWorkspaceAutoRecreation[\s\S]*?\n\}\s*\n/,
    )?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(
      /getWorkspaces\(\)\.find\(\s*\(\s*w\s*\)\s*=>\s*w\.primaryBranchedWorkspaceId\s*===\s*closedId/,
    );
    expect(fn).toMatch(/if\s*\(\s*!workspace\s*\)\s*return/);
  });
});
