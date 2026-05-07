/**
 * Tests for the workspace status registry.
 *
 * The status registry stores StatusItems contributed by extensions,
 * filtered by workspace for UI consumption.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  statusRegistry,
  setStatusItem,
  clearStatusItem,
  clearAllStatusForSourceAndWorkspace,
  clearAllStatusForWorkspace,
  getWorkspaceStatus,
  unregisterStatusBySource,
} from "../lib/services/status-registry";
import { REGISTRY_CLEANUP_FNS } from "../lib/services/extension-constants";

describe("status registry", () => {
  beforeEach(() => {
    statusRegistry.reset();
  });

  it("starts empty", () => {
    expect(get(statusRegistry.store)).toEqual([]);
  });

  // --- setStatusItem ---

  it("registers a status item with composite id", () => {
    setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });

    const items = get(statusRegistry.store);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "git:ws-1:branch",
      source: "git",
      workspaceId: "ws-1",
      category: "git",
      priority: 10,
      label: "main",
    });
  });

  it("upserts when same source + workspace + itemId", () => {
    setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "feat/status-bar",
    });

    const items = get(statusRegistry.store);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe("feat/status-bar");
  });

  it("keeps items from different workspaces separate", () => {
    setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    setStatusItem("git", "ws-2", "branch", {
      category: "git",
      priority: 10,
      label: "develop",
    });

    expect(get(statusRegistry.store)).toHaveLength(2);
  });

  // --- clearStatusItem ---

  it("removes a specific status item", () => {
    setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    clearStatusItem("git", "ws-1", "branch");

    expect(get(statusRegistry.store)).toHaveLength(0);
  });

  // --- clearAllStatusForSourceAndWorkspace ---

  it("removes all items from one source for one workspace", () => {
    setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    setStatusItem("git", "ws-1", "dirty", {
      category: "git",
      priority: 30,
      label: "3 modified",
    });
    setStatusItem("git", "ws-2", "branch", {
      category: "git",
      priority: 10,
      label: "develop",
    });

    clearAllStatusForSourceAndWorkspace("git", "ws-1");

    const items = get(statusRegistry.store);
    expect(items).toHaveLength(1);
    expect(items[0]!.workspaceId).toBe("ws-2");
  });

  // --- clearAllStatusForWorkspace ---

  it("removes all items for a workspace regardless of source", () => {
    setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    setStatusItem("docker", "ws-1", "container", {
      category: "process",
      priority: 40,
      label: "up",
    });
    setStatusItem("git", "ws-2", "branch", {
      category: "git",
      priority: 10,
      label: "develop",
    });

    clearAllStatusForWorkspace("ws-1");

    const items = get(statusRegistry.store);
    expect(items).toHaveLength(1);
    expect(items[0]!.workspaceId).toBe("ws-2");
  });

  // --- unregisterStatusBySource ---

  it("removes all items from a source across all workspaces", () => {
    setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    setStatusItem("git", "ws-2", "branch", {
      category: "git",
      priority: 10,
      label: "develop",
    });
    setStatusItem("docker", "ws-1", "container", {
      category: "process",
      priority: 40,
      label: "up",
    });

    unregisterStatusBySource("git");

    const items = get(statusRegistry.store);
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("docker");
  });

  // --- getWorkspaceStatus ---

  it("returns items filtered by workspace, sorted by priority", () => {
    setStatusItem("git", "ws-1", "dirty", {
      category: "git",
      priority: 30,
      label: "3 modified",
    });
    setStatusItem("git", "ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    setStatusItem("git", "ws-2", "branch", {
      category: "git",
      priority: 10,
      label: "develop",
    });

    const ws1Status = get(getWorkspaceStatus("ws-1"));
    expect(ws1Status).toHaveLength(2);
    expect(ws1Status[0]!.label).toBe("main"); // priority 10 first
    expect(ws1Status[1]!.label).toBe("3 modified"); // priority 30 second
  });

  it("memoizes derived store for same workspaceId", () => {
    const store1 = getWorkspaceStatus("ws-1");
    const store2 = getWorkspaceStatus("ws-1");
    expect(store1).toBe(store2);
  });

  // --- Extension cleanup integration ---

  it("is registered in REGISTRY_CLEANUP_FNS", () => {
    expect(REGISTRY_CLEANUP_FNS).toContain(unregisterStatusBySource);
  });
});
