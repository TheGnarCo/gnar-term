/**
 * Regression test for the umbrella-deletion phantom-recreate bug.
 *
 * `setupPrimaryWorkspaceAutoRecreation` listens for `workspace:closed` and,
 * when the closed nested workspace was an umbrella's `primaryNestedWorkspaceId`,
 * spawns a replacement primary nested workspace. That listener is correct
 * for "user closed only the primary nested workspace" — the umbrella must
 * keep a primary at all times.
 *
 * It used to be wrong for the deletion + archive flows. Both flows
 * cascade-closed nested workspaces BEFORE removing the umbrella from the
 * workspaces store, so the listener saw an intact umbrella, recreated the
 * primary, and only then did the umbrella vanish — leaving the phantom
 * primary behind with a `parentWorkspaceId` pointing to a now-deleted
 * umbrella. On reload `reconcilePrimaryWorkspaces` Pass 2 rewrapped the
 * orphan into a fresh umbrella, so deletes appeared to "come back" with
 * a new identity each time and extras accumulated.
 *
 * The fix is to remove the umbrella from the workspaces store first, so
 * the auto-recreate listener short-circuits. These source-scan assertions
 * pin the order at both call sites; archive-service.test.ts also asserts
 * the order behaviorally via mock invocation ordering.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("umbrella deletion cascades close AFTER removing the umbrella", () => {
  it("WorkspaceSectionContent.handleDeleteWorkspace calls deleteWorkspace before closeNestedWorkspacesInWorkspace", () => {
    const src = read("src/lib/components/WorkspaceSectionContent.svelte");
    const handler = src.match(
      /async function handleDeleteWorkspace\(\)[\s\S]*?\n\s*\}\s*\n/,
    )?.[0];
    expect(handler).toBeDefined();
    const deleteIdx = handler!.indexOf("deleteWorkspace(w.id)");
    const closeIdx = handler!.indexOf("closeNestedWorkspacesInWorkspace(w.id)");
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(closeIdx);
  });

  it("archive-service.archiveWorkspace removes the umbrella from setWorkspaces before closeNestedWorkspacesInWorkspace", () => {
    const src = read("src/lib/services/archive-service.ts");
    const fn = src.match(
      /export async function archiveWorkspace[\s\S]*?\n\}\s*\n/,
    )?.[0];
    expect(fn).toBeDefined();
    const setIdx = fn!.indexOf("setWorkspaces(getWorkspaces().filter");
    const closeIdx = fn!.indexOf("closeNestedWorkspacesInWorkspace");
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeLessThan(closeIdx);
  });

  it("setupPrimaryWorkspaceAutoRecreation early-returns when no umbrella claims the closed primary", () => {
    // The listener's safety net: even if a future caller forgets to
    // remove the umbrella first, the listener must still defend against
    // recreating a primary for a workspace that doesn't exist.
    const src = read("src/lib/services/workspace-service.ts");
    const fn = src.match(
      /export function setupPrimaryWorkspaceAutoRecreation[\s\S]*?\n\}\s*\n/,
    )?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(
      /getWorkspaces\(\)\.find\(\s*\(\s*w\s*\)\s*=>\s*w\.primaryNestedWorkspaceId\s*===\s*closedId/,
    );
    expect(fn).toMatch(/if\s*\(\s*!workspace\s*\)\s*return/);
  });
});
