/**
 * Tests for the managed-workspaces included extension — validates that it
 * registers a workspace action and archive command via the extension API,
 * and correctly manages state for worktree-backed workspaces.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import {
  managedWorkspacesManifest,
  registerManagedWorkspacesExtension,
} from "../extensions/managed-workspaces";
import { commandStore, resetCommands } from "../lib/services/command-registry";
import {
  workspaceActionStore,
  resetWorkspaceActions,
} from "../lib/services/workspace-action-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
  getExtensionApiById,
} from "../lib/services/extension-loader";

describe("Managed Workspaces included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetCommands();
    resetWorkspaceActions();
  });

  it("manifest has correct id and metadata", () => {
    expect(managedWorkspacesManifest.id).toBe("managed-workspaces");
    expect(managedWorkspacesManifest.name).toBe("Managed Workspaces");
    expect(managedWorkspacesManifest.included).toBe(true);
  });

  it("manifest declares workspace events", () => {
    expect(managedWorkspacesManifest.contributes?.events).toContain(
      "workspace:created",
    );
    expect(managedWorkspacesManifest.contributes?.events).toContain(
      "workspace:closed",
    );
  });

  it("manifest declares one command (archive-workspace)", () => {
    const commands = managedWorkspacesManifest.contributes?.commands;
    expect(commands).toHaveLength(1);
    expect(commands![0].id).toBe("archive-workspace");
    expect(commands![0].title).toBe("Archive Managed Workspace...");
  });

  it("manifest declares workspace action instead of primary sidebar section", () => {
    expect(
      managedWorkspacesManifest.contributes?.primarySidebarSections,
    ).toBeUndefined();
    const actions = managedWorkspacesManifest.contributes?.workspaceActions;
    expect(actions).toHaveLength(1);
    expect(actions![0].id).toBe("create-worktree-workspace");
    expect(actions![0].title).toBe("New Managed Workspace");
  });

  it("manifest declares branchPrefix, copyPatterns, and setupScript settings", () => {
    const fields = managedWorkspacesManifest.contributes?.settings?.fields;
    expect(fields).toBeTruthy();
    expect(fields!.branchPrefix).toMatchObject({
      type: "string",
      title: "Branch Prefix",
      default: "",
    });
    expect(fields!.copyPatterns).toMatchObject({
      type: "string",
      title: "Copy Patterns",
      default: ".env,.env.local",
    });
    expect(fields!.setupScript).toMatchObject({
      type: "string",
      title: "Setup Script",
      default: "",
    });
  });

  it("registers workspace action with correct id on activation", async () => {
    registerExtension(
      managedWorkspacesManifest,
      registerManagedWorkspacesExtension,
    );
    await activateExtension("managed-workspaces");
    const actions = get(workspaceActionStore);
    const action = actions.find(
      (a) => a.id === "managed-workspaces:create-worktree-workspace",
    );
    expect(action).toBeTruthy();
    expect(action!.label).toBe("New Managed Workspace");
    expect(action!.icon).toBe("git-branch");
    expect(action!.source).toBe("managed-workspaces");
  });

  it("workspace action when filter returns true with no project context", async () => {
    registerExtension(
      managedWorkspacesManifest,
      registerManagedWorkspacesExtension,
    );
    await activateExtension("managed-workspaces");
    const actions = get(workspaceActionStore);
    const action = actions.find(
      (a) => a.id === "managed-workspaces:create-worktree-workspace",
    );
    expect(action!.when!({})).toBe(true);
  });

  it("workspace action when filter returns true when isGit is true", async () => {
    registerExtension(
      managedWorkspacesManifest,
      registerManagedWorkspacesExtension,
    );
    await activateExtension("managed-workspaces");
    const actions = get(workspaceActionStore);
    const action = actions.find(
      (a) => a.id === "managed-workspaces:create-worktree-workspace",
    );
    expect(action!.when!({ projectId: "proj-1", isGit: true })).toBe(true);
  });

  it("workspace action when filter returns false when isGit is false", async () => {
    registerExtension(
      managedWorkspacesManifest,
      registerManagedWorkspacesExtension,
    );
    await activateExtension("managed-workspaces");
    const actions = get(workspaceActionStore);
    const action = actions.find(
      (a) => a.id === "managed-workspaces:create-worktree-workspace",
    );
    expect(action!.when!({ projectId: "proj-1", isGit: false })).toBe(false);
  });

  it("registers archive-workspace command via API", async () => {
    registerExtension(
      managedWorkspacesManifest,
      registerManagedWorkspacesExtension,
    );
    await activateExtension("managed-workspaces");
    const cmds = get(commandStore);
    const cmd = cmds.find(
      (c) => c.id === "managed-workspaces:archive-workspace",
    );
    expect(cmd).toBeTruthy();
    expect(cmd!.title).toBe("Archive Managed Workspace...");
    expect(cmd!.source).toBe("managed-workspaces");
  });

  it("state starts with empty managed workspaces", async () => {
    registerExtension(
      managedWorkspacesManifest,
      registerManagedWorkspacesExtension,
    );
    await activateExtension("managed-workspaces");
    const api = getExtensionApiById("managed-workspaces");
    expect(api).toBeTruthy();
    expect(api!.state.get("managedWorkspaces")).toBeUndefined();
  });

  it("state persists managed workspace entries via set/get", async () => {
    registerExtension(
      managedWorkspacesManifest,
      registerManagedWorkspacesExtension,
    );
    await activateExtension("managed-workspaces");
    const api = getExtensionApiById("managed-workspaces");
    expect(api).toBeTruthy();

    const entries = [
      {
        worktreePath: "/repo/../feature-x",
        branch: "feature-x",
        baseBranch: "main",
        repoPath: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    api!.state.set("managedWorkspaces", entries);

    const retrieved = api!.state.get("managedWorkspaces");
    expect(retrieved).toEqual(entries);
  });
});
