/**
 * Tests for the managed-workspaces included extension — validates that it
 * registers a primary sidebar section and commands via the extension API,
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
import {
  sidebarSectionStore,
  resetSidebarSections,
} from "../lib/services/sidebar-section-registry";
import { commandStore, resetCommands } from "../lib/services/command-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
  getExtensionApiById,
} from "../lib/services/extension-loader";

describe("Managed Workspaces included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSidebarSections();
    resetCommands();
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

  it("manifest declares two commands", () => {
    const commands = managedWorkspacesManifest.contributes?.commands;
    expect(commands).toHaveLength(2);
    expect(commands![0].id).toBe("create-worktree-workspace");
    expect(commands![1].id).toBe("archive-workspace");
  });

  it("manifest declares primary sidebar section", () => {
    const sections =
      managedWorkspacesManifest.contributes?.primarySidebarSections;
    expect(sections).toHaveLength(1);
    expect(sections![0].id).toBe("managed-workspaces");
    expect(sections![0].label).toBe("Managed Workspaces");
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

  it("registers primary sidebar section via API with namespaced id", async () => {
    registerExtension(
      managedWorkspacesManifest,
      registerManagedWorkspacesExtension,
    );
    await activateExtension("managed-workspaces");
    const sections = get(sidebarSectionStore);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("managed-workspaces:managed-workspaces");
    expect(sections[0].label).toBe("Managed Workspaces");
    expect(sections[0].source).toBe("managed-workspaces");
    expect(sections[0].component).toBeTruthy();
  });

  it("registers create-worktree-workspace command via API", async () => {
    registerExtension(
      managedWorkspacesManifest,
      registerManagedWorkspacesExtension,
    );
    await activateExtension("managed-workspaces");
    const cmds = get(commandStore);
    const cmd = cmds.find(
      (c) => c.id === "managed-workspaces:create-worktree-workspace",
    );
    expect(cmd).toBeTruthy();
    expect(cmd!.title).toBe("Create Worktree Workspace...");
    expect(cmd!.source).toBe("managed-workspaces");
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
        workspaceId: "feature-x",
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
