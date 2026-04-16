/**
 * Tests for the merge-archive-workspace command in the managed-workspaces
 * extension. Validates merge success/failure flows, dirty worktree handling,
 * event emission, manifest declarations, and workspace ID tracking.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

// Mock Tauri invoke — controls git_status, git_checkout, git_merge, etc.
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Mock clipboard (required by extension-loader)
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

// Mock UI prompts so we can control user responses
const mockShowInputPrompt =
  vi.fn<(label: string, defaultValue?: string) => Promise<string | null>>();
const mockShowFormPrompt = vi.fn<
  (
    title: string,
    fields: Array<{
      key: string;
      label: string;
      defaultValue?: string;
      placeholder?: string;
    }>,
  ) => Promise<Record<string, string> | null>
>();
vi.mock("../lib/stores/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/stores/ui")>();
  return {
    ...actual,
    showInputPrompt: (...args: [string, string?]) =>
      mockShowInputPrompt(...args),
    showFormPrompt: (
      ...args: [
        string,
        Array<{
          key: string;
          label: string;
          defaultValue?: string;
          placeholder?: string;
        }>,
      ]
    ) => mockShowFormPrompt(...args),
  };
});

import {
  managedWorkspacesManifest,
  registerManagedWorkspacesExtension,
} from "../extensions/managed-workspaces";
import { commandStore, resetCommands } from "../lib/services/command-registry";
import { resetWorkspaceActions } from "../lib/services/workspace-action-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
  getExtensionApiById,
} from "../lib/services/extension-loader";
import { eventBus } from "../lib/services/event-bus";

/** Helper: register & activate the managed-workspaces extension */
async function setup() {
  registerExtension(
    managedWorkspacesManifest,
    registerManagedWorkspacesExtension,
  );
  await activateExtension("managed-workspaces");
}

/** Helper: seed a managed workspace entry into extension state */
function seedEntry(
  overrides: Partial<{
    worktreePath: string;
    branch: string;
    baseBranch: string;
    repoPath: string;
    createdAt: string;
    workspaceId: string;
  }> = {},
) {
  const api = getExtensionApiById("managed-workspaces")!;
  const entry = {
    worktreePath: overrides.worktreePath ?? "/repos/myrepo-feat-x",
    branch: overrides.branch ?? "feat-x",
    baseBranch: overrides.baseBranch ?? "main",
    repoPath: overrides.repoPath ?? "/repos/myrepo",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...(overrides.workspaceId ? { workspaceId: overrides.workspaceId } : {}),
  };
  api.state.set("managedWorkspaces", [entry]);
  return entry;
}

/** Helper: get the merge-archive command from the store and call it */
function getMergeArchiveCmd() {
  const cmds = get(commandStore);
  return cmds.find(
    (c) => c.id === "managed-workspaces:merge-archive-workspace",
  );
}

describe("Merge & Archive Worktree", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetCommands();
    resetWorkspaceActions();
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockShowInputPrompt.mockReset();
    mockShowFormPrompt.mockReset();
  });

  // --- Manifest tests ---

  it("manifest declares merge-archive-workspace command", () => {
    const commands = managedWorkspacesManifest.contributes?.commands;
    const cmd = commands?.find((c) => c.id === "merge-archive-workspace");
    expect(cmd).toBeTruthy();
    expect(cmd!.title).toBe("Merge & Archive Worktree...");
  });

  it("manifest declares extension:worktree:merged event", () => {
    const events = managedWorkspacesManifest.contributes?.events;
    expect(events).toContain("extension:worktree:merged");
  });

  it("manifest declares mergeStrategy setting", () => {
    const fields = managedWorkspacesManifest.contributes?.settings?.fields;
    expect(fields?.mergeStrategy).toMatchObject({
      type: "select",
      title: "Merge Strategy",
      default: "merge",
    });
    expect(fields?.mergeStrategy?.options).toEqual([
      { label: "Merge", value: "merge" },
      { label: "Squash", value: "squash" },
      { label: "Rebase", value: "rebase" },
    ]);
  });

  // --- Command registration ---

  it("registers merge-archive-workspace command on activation", async () => {
    await setup();
    const cmd = getMergeArchiveCmd();
    expect(cmd).toBeTruthy();
    expect(cmd!.source).toBe("managed-workspaces");
  });

  // --- Merge success flow ---

  it("merges, archives, emits event, and removes entry on success", async () => {
    await setup();
    const entry = seedEntry({ workspaceId: "ws-42" });

    // User selects the branch
    mockShowInputPrompt
      .mockResolvedValueOnce(entry.branch) // "which worktree?"
      .mockResolvedValueOnce("yes"); // "push before archiving?"

    // git_status returns clean, git_merge returns success
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout") return Promise.resolve(undefined);
      if (cmd === "git_merge")
        return Promise.resolve({ success: true, message: "Merged" });
      if (cmd === "push_branch") return Promise.resolve(undefined);
      if (cmd === "remove_worktree") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    // Listen for the merged event
    const emitted: Record<string, unknown>[] = [];
    const handler = (ev: Record<string, unknown>) => emitted.push(ev);
    eventBus.on("extension:worktree:merged", handler);

    const cmd = getMergeArchiveCmd()!;
    await cmd.action();

    // Verify git_status was called on the worktree
    expect(mockInvoke).toHaveBeenCalledWith("git_status", {
      repoPath: entry.worktreePath,
    });

    // Verify git_checkout was called to switch to base branch
    expect(mockInvoke).toHaveBeenCalledWith("git_checkout", {
      repoPath: entry.repoPath,
      branch: entry.baseBranch,
    });

    // Verify git_merge was called on the main repo
    expect(mockInvoke).toHaveBeenCalledWith("git_merge", {
      repoPath: entry.repoPath,
      branch: entry.branch,
    });

    // Verify push was called (user said yes)
    expect(mockInvoke).toHaveBeenCalledWith("push_branch", {
      repoPath: entry.repoPath,
      branch: entry.baseBranch,
    });

    // Verify worktree was removed
    expect(mockInvoke).toHaveBeenCalledWith("remove_worktree", {
      repoPath: entry.repoPath,
      worktreePath: entry.worktreePath,
    });

    // Verify event was emitted with correct payload
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: "extension:worktree:merged",
      worktreePath: entry.worktreePath,
      branch: entry.branch,
      baseBranch: entry.baseBranch,
      repoPath: entry.repoPath,
      workspaceId: "ws-42",
    });

    // Verify entry was removed from state
    const api = getExtensionApiById("managed-workspaces")!;
    const remaining = api.state.get<unknown[]>("managedWorkspaces");
    expect(remaining).toEqual([]);

    eventBus.off("extension:worktree:merged", handler);
  });

  // --- Merge conflict flow ---

  it("aborts merge on conflict, preserves state, shows conflict list", async () => {
    await setup();
    const entry = seedEntry();

    mockShowInputPrompt.mockResolvedValueOnce(entry.branch);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout") return Promise.resolve(undefined);
      if (cmd === "git_merge")
        return Promise.resolve({
          success: false,
          message: "Conflict",
          conflicts: ["src/app.ts", "package.json"],
        });
      return Promise.resolve(undefined);
    });

    // showFormPrompt called for conflict display — just dismiss
    mockShowFormPrompt.mockResolvedValueOnce(null);

    const emitted: unknown[] = [];
    const handler = (ev: unknown) => emitted.push(ev);
    eventBus.on("extension:worktree:merged", handler);

    const cmd = getMergeArchiveCmd()!;
    await cmd.action();

    // Verify conflict message was shown
    expect(mockShowFormPrompt).toHaveBeenCalledWith(
      "Merge failed — conflicts detected",
      expect.arrayContaining([
        expect.objectContaining({
          key: "conflicts",
          defaultValue: "src/app.ts\npackage.json",
        }),
      ]),
    );

    // Verify remove_worktree was NOT called
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "remove_worktree",
      expect.anything(),
    );

    // Verify event was NOT emitted
    expect(emitted).toHaveLength(0);

    // Verify state is preserved
    const api = getExtensionApiById("managed-workspaces")!;
    const entries = api.state.get<unknown[]>("managedWorkspaces");
    expect(entries).toHaveLength(1);

    eventBus.off("extension:worktree:merged", handler);
  });

  // --- Dirty worktree flow ---

  it("aborts if worktree has uncommitted changes", async () => {
    await setup();
    const entry = seedEntry();

    mockShowInputPrompt.mockResolvedValueOnce(entry.branch);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status")
        return Promise.resolve([{ path: "src/dirty.ts", status: "modified" }]);
      return Promise.resolve(undefined);
    });

    // showFormPrompt called for the dirty warning — just dismiss
    mockShowFormPrompt.mockResolvedValueOnce(null);

    const cmd = getMergeArchiveCmd()!;
    await cmd.action();

    // Verify the dirty warning was shown
    expect(mockShowFormPrompt).toHaveBeenCalledWith(
      "Cannot merge",
      expect.arrayContaining([
        expect.objectContaining({
          label: "Worktree has uncommitted changes",
        }),
      ]),
    );

    // Verify git_merge was NOT called
    expect(mockInvoke).not.toHaveBeenCalledWith("git_merge", expect.anything());

    // Verify git_checkout was NOT called (never got past status check)
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "git_checkout",
      expect.anything(),
    );

    // Verify state is preserved
    const api = getExtensionApiById("managed-workspaces")!;
    const entries = api.state.get<unknown[]>("managedWorkspaces");
    expect(entries).toHaveLength(1);
  });

  // --- Early exit: no entries ---

  it("returns early when no managed workspaces exist", async () => {
    await setup();
    // Don't seed any entries

    const cmd = getMergeArchiveCmd()!;
    await cmd.action();

    // No prompts shown
    expect(mockShowInputPrompt).not.toHaveBeenCalled();
    expect(mockShowFormPrompt).not.toHaveBeenCalled();
  });

  // --- Early exit: user cancels branch selection ---

  it("returns early when user cancels branch selection", async () => {
    await setup();
    seedEntry();

    mockShowInputPrompt.mockResolvedValueOnce(null); // user cancels

    const cmd = getMergeArchiveCmd()!;
    await cmd.action();

    // No git commands invoked
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "git_status",
      expect.anything(),
    );
  });

  // --- Early exit: branch not found ---

  it("returns early when selected branch does not match any entry", async () => {
    await setup();
    seedEntry();

    mockShowInputPrompt.mockResolvedValueOnce("nonexistent-branch");

    const cmd = getMergeArchiveCmd()!;
    await cmd.action();

    // No git commands invoked
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "git_status",
      expect.anything(),
    );
  });

  // --- Checkout failure ---

  it("shows error and aborts when base branch checkout fails", async () => {
    await setup();
    const entry = seedEntry();

    mockShowInputPrompt.mockResolvedValueOnce(entry.branch);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout")
        return Promise.reject(new Error("checkout failed"));
      return Promise.resolve(undefined);
    });

    mockShowFormPrompt.mockResolvedValueOnce(null);

    const cmd = getMergeArchiveCmd()!;
    await cmd.action();

    // Verify error dialog was shown
    expect(mockShowFormPrompt).toHaveBeenCalledWith(
      "Failed to checkout base branch",
      expect.arrayContaining([
        expect.objectContaining({
          key: "error",
        }),
      ]),
    );

    // Verify merge was NOT attempted
    expect(mockInvoke).not.toHaveBeenCalledWith("git_merge", expect.anything());
  });

  // --- workspace:created handler captures workspaceId ---

  it("workspace:created event handler captures workspaceId into entry", async () => {
    await setup();
    const entry = seedEntry();

    // Simulate workspace:created event
    eventBus.emit({
      type: "workspace:created",
      id: "ws-99",
      name: "Worktree 1",
      metadata: { worktreePath: entry.worktreePath },
    });

    const api = getExtensionApiById("managed-workspaces")!;
    const entries =
      api.state.get<Array<{ workspaceId?: string }>>("managedWorkspaces");
    expect(entries).toHaveLength(1);
    expect(entries![0].workspaceId).toBe("ws-99");
  });

  it("workspace:created event does not modify entries without matching worktreePath", async () => {
    await setup();
    seedEntry();

    eventBus.emit({
      type: "workspace:created",
      id: "ws-100",
      name: "Other Workspace",
      metadata: { worktreePath: "/some/other/path" },
    });

    const api = getExtensionApiById("managed-workspaces")!;
    const entries =
      api.state.get<Array<{ workspaceId?: string }>>("managedWorkspaces");
    expect(entries![0].workspaceId).toBeUndefined();
  });

  // --- workspaceId in event payload ---

  it("emits empty string for workspaceId when not tracked", async () => {
    await setup();
    const entry = seedEntry(); // no workspaceId set

    mockShowInputPrompt
      .mockResolvedValueOnce(entry.branch)
      .mockResolvedValueOnce("no"); // don't push

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout") return Promise.resolve(undefined);
      if (cmd === "git_merge")
        return Promise.resolve({ success: true, message: "Merged" });
      if (cmd === "remove_worktree") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const emitted: Record<string, unknown>[] = [];
    const handler = (ev: Record<string, unknown>) => emitted.push(ev);
    eventBus.on("extension:worktree:merged", handler);

    const cmd = getMergeArchiveCmd()!;
    await cmd.action();

    expect(emitted[0]).toMatchObject({ workspaceId: "" });

    eventBus.off("extension:worktree:merged", handler);
  });

  // --- Push declined flow ---

  it("skips push when user declines", async () => {
    await setup();
    const entry = seedEntry();

    mockShowInputPrompt
      .mockResolvedValueOnce(entry.branch)
      .mockResolvedValueOnce("no"); // decline push

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout") return Promise.resolve(undefined);
      if (cmd === "git_merge")
        return Promise.resolve({ success: true, message: "Merged" });
      if (cmd === "remove_worktree") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const cmd = getMergeArchiveCmd()!;
    await cmd.action();

    // push_branch should NOT be called
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "push_branch",
      expect.anything(),
    );

    // But remove_worktree should still be called
    expect(mockInvoke).toHaveBeenCalledWith("remove_worktree", {
      repoPath: entry.repoPath,
      worktreePath: entry.worktreePath,
    });
  });
});
