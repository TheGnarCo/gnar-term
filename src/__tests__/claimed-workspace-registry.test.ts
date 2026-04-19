/**
 * Tests for claimed-workspace-registry — extensions claim workspace IDs
 * so they render in extension sidebar sections instead of the main list.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  claimedWorkspaceIds,
  claimWorkspace,
  unclaimWorkspace,
  unclaimBySource,
  resetClaimedWorkspaces,
} from "../lib/services/claimed-workspace-registry";

describe("claimed-workspace-registry", () => {
  beforeEach(() => {
    resetClaimedWorkspaces();
  });

  it("starts with no claimed workspaces", () => {
    expect(get(claimedWorkspaceIds).size).toBe(0);
  });

  it("claims a workspace", () => {
    claimWorkspace("ws-1", "ext-git");
    const ids = get(claimedWorkspaceIds);
    expect(ids.has("ws-1")).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("claims multiple workspaces from different sources", () => {
    claimWorkspace("ws-1", "ext-git");
    claimWorkspace("ws-2", "ext-docker");
    const ids = get(claimedWorkspaceIds);
    expect(ids.size).toBe(2);
    expect(ids.has("ws-1")).toBe(true);
    expect(ids.has("ws-2")).toBe(true);
  });

  it("unclaims a workspace by id", () => {
    claimWorkspace("ws-1", "ext-git");
    claimWorkspace("ws-2", "ext-git");
    unclaimWorkspace("ws-1");
    const ids = get(claimedWorkspaceIds);
    expect(ids.size).toBe(1);
    expect(ids.has("ws-1")).toBe(false);
    expect(ids.has("ws-2")).toBe(true);
  });

  it("unclaims all workspaces by source extension", () => {
    claimWorkspace("ws-1", "ext-git");
    claimWorkspace("ws-2", "ext-git");
    claimWorkspace("ws-3", "ext-docker");
    unclaimBySource("ext-git");
    const ids = get(claimedWorkspaceIds);
    expect(ids.size).toBe(1);
    expect(ids.has("ws-3")).toBe(true);
  });

  it("unclaimBySource is a no-op for unknown source", () => {
    claimWorkspace("ws-1", "ext-git");
    unclaimBySource("ext-unknown");
    expect(get(claimedWorkspaceIds).size).toBe(1);
  });

  it("resets to empty", () => {
    claimWorkspace("ws-1", "ext-git");
    claimWorkspace("ws-2", "ext-docker");
    resetClaimedWorkspaces();
    expect(get(claimedWorkspaceIds).size).toBe(0);
  });

  it("re-claiming with a different source updates the owner", () => {
    claimWorkspace("ws-1", "ext-git");
    claimWorkspace("ws-1", "ext-docker");
    // ws-1 is now owned by ext-docker
    unclaimBySource("ext-git");
    expect(get(claimedWorkspaceIds).has("ws-1")).toBe(true);
    unclaimBySource("ext-docker");
    expect(get(claimedWorkspaceIds).has("ws-1")).toBe(false);
  });
});
