/**
 * Tests for the extension API status sub-module.
 *
 * Verifies that createStatusAPI correctly delegates to the status registry
 * with proper extension ID scoping.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { createStatusAPI } from "../lib/services/extension-api-status";
import { statusRegistry } from "../lib/services/status-registry";

describe("createStatusAPI", () => {
  const api = createStatusAPI("test-ext");

  beforeEach(() => {
    statusRegistry.reset();
  });

  it("setStatus registers a namespaced item", () => {
    api.setStatus("ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });

    const items = get(statusRegistry.store);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "test-ext:ws-1:branch",
      source: "test-ext",
      workspaceId: "ws-1",
      label: "main",
    });
  });

  it("clearStatus removes a specific item", () => {
    api.setStatus("ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    api.clearStatus("ws-1", "branch");

    expect(get(statusRegistry.store)).toHaveLength(0);
  });

  it("clearAllStatus removes only this extension's items for a workspace", () => {
    api.setStatus("ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    api.setStatus("ws-1", "dirty", {
      category: "git",
      priority: 30,
      label: "3 modified",
    });

    // Another extension's item
    const other = createStatusAPI("other-ext");
    other.setStatus("ws-1", "deploy", {
      category: "info",
      priority: 50,
      label: "deployed",
    });

    api.clearAllStatus("ws-1");

    const items = get(statusRegistry.store);
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("other-ext");
  });

  it("getWorkspaceStatus returns filtered store", () => {
    api.setStatus("ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    api.setStatus("ws-2", "branch", {
      category: "git",
      priority: 10,
      label: "develop",
    });

    const ws1 = get(api.getWorkspaceStatus("ws-1"));
    expect(ws1).toHaveLength(1);
    expect(ws1[0]!.label).toBe("main");
  });

  it("getWorkspaceStatusByCategory filters by category", () => {
    api.setStatus("ws-1", "branch", {
      category: "git",
      priority: 10,
      label: "main",
    });
    api.setStatus("ws-1", "agent", {
      category: "process",
      priority: 0,
      label: "running",
    });

    const gitOnly = get(api.getWorkspaceStatusByCategory("ws-1", "git"));
    expect(gitOnly).toHaveLength(1);
    expect(gitOnly[0]!.label).toBe("main");
  });
});
