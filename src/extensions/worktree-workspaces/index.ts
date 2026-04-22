/**
 * Worktrees — included extension
 *
 * Git worktree-backed workspace management. Creates worktrees, opens them
 * as workspaces, and archives them when done. Uses workspace actions
 * instead of a sidebar section for workspace creation.
 */
import type {
  ExtensionManifest,
  ExtensionAPI,
  MergeResult,
  AppEvent,
} from "../api";
import {
  resolveRepoPath,
  promptWorktreeConfig,
  createWorktree,
} from "../shared/worktree-helpers";

interface WorktreeWorkspaceEntry {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  repoPath: string;
  createdAt: string;
  workspaceId?: string;
}

export const worktreeWorkspacesManifest: ExtensionManifest = {
  id: "worktree-workspaces",
  name: "Worktree Workspaces",
  version: "0.1.0",
  description: "Git worktree-backed workspace management",
  entry: "./index.ts",
  included: true,
  permissions: ["pty", "shell", "filesystem"],
  contributes: {
    commands: [
      { id: "archive-workspace", title: "Archive Worktree..." },
      { id: "merge-archive-workspace", title: "Merge & Archive Worktree..." },
    ],
    workspaceActions: [
      { id: "create-worktree-workspace", title: "New Worktree" },
    ],
    settings: {
      fields: {
        branchPrefix: {
          type: "string",
          title: "Branch Prefix",
          description: "Prefix for new worktree branches",
          default: "",
        },
        copyPatterns: {
          type: "string",
          title: "Copy Patterns",
          description:
            "Glob patterns to copy into new worktrees (comma-separated)",
          default: ".env,.env.local",
        },
        setupScript: {
          type: "string",
          title: "Setup Script",
          description:
            "Command to run after creating a worktree (e.g., 'npm install')",
          default: "",
        },
        mergeStrategy: {
          type: "select",
          title: "Merge Strategy",
          description: "How to merge worktree branches back to base",
          default: "merge",
          options: [
            { label: "Merge", value: "merge" },
            { label: "Squash", value: "squash" },
            { label: "Rebase", value: "rebase" },
          ],
        },
      },
    },
    events: [
      "workspace:created",
      "workspace:closed",
      "extension:worktree:merged",
    ],
  },
};

function getWorktreeWorkspaces(api: ExtensionAPI): WorktreeWorkspaceEntry[] {
  return api.state.get<WorktreeWorkspaceEntry[]>("worktreeWorkspaces") || [];
}

function saveWorktreeWorkspaces(
  api: ExtensionAPI,
  entries: WorktreeWorkspaceEntry[],
): void {
  api.state.set("worktreeWorkspaces", entries);
}

export function registerWorktreeWorkspacesExtension(api: ExtensionAPI): void {
  // Named handlers so api.off() in onDeactivate removes the same listeners
  // api.on() added — without named refs, a disable/re-enable cycle stacks a
  // fresh copy of every handler (workspace:created, workspace:closed) each
  // time, causing duplicate "keep/delete worktree" prompts on close.
  const onWorkspaceCreated = (event: AppEvent) => {
    const metadata = (event as Record<string, unknown>).metadata as
      | Record<string, unknown>
      | undefined;
    const id = (event as Record<string, unknown>).id as string | undefined;
    if (metadata?.worktreePath && id) {
      const entries = getWorktreeWorkspaces(api);
      const entry = entries.find(
        (e) => e.worktreePath === metadata.worktreePath,
      );
      if (entry) {
        entry.workspaceId = id;
        saveWorktreeWorkspaces(api, entries);
      }
    }
  };

  const onWorkspaceClosed = (event: AppEvent) => {
    const id = (event as Record<string, unknown>).id as string | undefined;
    if (!id) return;
    const entries = getWorktreeWorkspaces(api);
    const entry = entries.find((e) => e.workspaceId === id);
    if (!entry) return;

    void (async () => {
      const result = await api.showFormPrompt(
        `Worktree for "${entry.branch}"`,
        [
          {
            key: "path",
            label: "Worktree location",
            type: "info",
            defaultValue: entry.worktreePath,
          },
          {
            key: "action",
            label: "What should happen to the worktree?",
            type: "select",
            defaultValue: "keep",
            options: [
              { label: "Keep worktree on disk", value: "keep" },
              {
                label: "Delete worktree (git worktree remove)",
                value: "delete",
              },
            ],
          },
        ],
        { submitLabel: "Apply" },
      );

      const remaining = getWorktreeWorkspaces(api).filter(
        (e) => e.workspaceId !== id,
      );
      saveWorktreeWorkspaces(api, remaining);

      if (result?.action !== "delete") return;

      try {
        await api.invoke("remove_worktree", {
          repoPath: entry.repoPath,
          worktreePath: entry.worktreePath,
        });
      } catch (err) {
        api.reportError(
          `Failed to remove worktree at ${entry.worktreePath}: ${err}`,
        );
      }
    })();
  };

  api.onActivate(() => {
    api.registerWorkspaceAction("create-worktree-workspace", {
      label: "New Worktree",
      icon: "git-branch",
      handler: async (ctx) => {
        // Step 1: Validate repo
        const repoPath = await resolveRepoPath(api, ctx.projectPath);
        if (!repoPath) return;

        // Step 2: Prompt for branch details
        const branchPrefix = api.getSetting<string>("branchPrefix") || "";
        const config = await promptWorktreeConfig(api, repoPath, {
          branchPrefix,
        });
        if (!config) return;

        // Step 3: Create the worktree
        const ok = await createWorktree(api, config);
        if (!ok) return;

        const { branch, base, worktreePath } = config;

        // Copy config files if setting is configured
        const copyPatternsStr = api.getSetting<string>("copyPatterns") || "";
        if (copyPatternsStr.trim()) {
          const patterns = copyPatternsStr
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean);
          if (patterns.length > 0) {
            try {
              await api.invoke("copy_files", {
                sourceDir: repoPath,
                destDir: worktreePath,
                patterns,
              });
            } catch {
              // Non-fatal — continue even if copy fails
            }
          }
        }

        // Run setup script if configured
        const setupScript = api.getSetting<string>("setupScript") || "";
        if (setupScript.trim()) {
          try {
            await api.invoke("run_script", {
              cwd: worktreePath,
              command: setupScript,
            });
          } catch {
            // Non-fatal
          }
        }

        // Step 4: Create the workspace (independent "Worktree N" counter)
        const worktreeCount = getWorktreeWorkspaces(api).length + 1;
        const wsName = `Worktree ${worktreeCount}`;
        api.createWorkspace(wsName, worktreePath, {
          env: { GNARTERM_WORKTREE_ROOT: repoPath },
          metadata: {
            worktreePath,
            branch,
            baseBranch: base,
            repoPath,
            ...(ctx.projectId ? { projectId: String(ctx.projectId) } : {}),
          },
        });

        // Save to state
        const entries = getWorktreeWorkspaces(api);
        entries.push({
          worktreePath,
          branch,
          baseBranch: base,
          repoPath,
          createdAt: new Date().toISOString(),
        });
        saveWorktreeWorkspaces(api, entries);
      },
      when: (ctx) => {
        // Top level: always show
        if (!ctx.projectId) return true;
        // In project context: only show if project is a git repo
        return ctx.isGit === true;
      },
    });

    api.on("workspace:created", onWorkspaceCreated);
    api.on("workspace:closed", onWorkspaceClosed);

    api.registerCommand("archive-workspace", async () => {
      const entries = getWorktreeWorkspaces(api);
      if (entries.length === 0) return;

      const branchNames = entries.map((e) => e.branch).join(", ");
      const selected = await api.showInputPrompt(
        `Archive which workspace? (${branchNames})`,
      );
      if (!selected) return;

      const entry = entries.find((e) => e.branch === selected.trim());
      if (!entry) return;

      const shouldPush = await api.showInputPrompt(
        "Push branch before archiving? (yes/no)",
        "yes",
      );

      if (shouldPush?.toLowerCase() === "yes") {
        await api.invoke("push_branch", {
          repoPath: entry.repoPath,
          branch: entry.branch,
        });
      }

      await api.invoke("remove_worktree", {
        repoPath: entry.repoPath,
        worktreePath: entry.worktreePath,
      });

      const remaining = entries.filter((e) => e.branch !== selected.trim());
      saveWorktreeWorkspaces(api, remaining);
    });

    api.registerCommand("merge-archive-workspace", async () => {
      const entries = getWorktreeWorkspaces(api);
      if (entries.length === 0) return;

      const branchNames = entries.map((e) => e.branch).join(", ");
      const selected = await api.showInputPrompt(
        `Merge & archive which worktree? (${branchNames})`,
      );
      if (!selected) return;

      const entry = entries.find((e) => e.branch === selected.trim());
      if (!entry) return;

      // Pre-merge check: worktree must be clean
      const status = await api.invoke<Array<{ path: string; status: string }>>(
        "git_status",
        { repoPath: entry.worktreePath },
      );
      if (status.length > 0) {
        await api.showFormPrompt("Cannot merge", [
          {
            key: "error",
            label: "Worktree has uncommitted changes",
            defaultValue: `${status.length} file(s) modified. Commit or stash before merging.`,
          },
        ]);
        return;
      }

      // Checkout base branch in main repo
      try {
        await api.invoke("git_checkout", {
          repoPath: entry.repoPath,
          branch: entry.baseBranch,
        });
      } catch (err) {
        await api.showFormPrompt("Failed to checkout base branch", [
          {
            key: "error",
            label: "Error",
            defaultValue: String(err),
          },
        ]);
        return;
      }

      // Merge feature branch into base
      const result = await api.invoke<MergeResult>("git_merge", {
        repoPath: entry.repoPath,
        branch: entry.branch,
      });

      if (!result.success) {
        const conflictList =
          result.conflicts?.join("\n") || "Unknown conflicts";
        await api.showFormPrompt("Merge failed — conflicts detected", [
          {
            key: "conflicts",
            label: "Conflicting files (merge has been aborted)",
            defaultValue: conflictList,
          },
        ]);
        return;
      }

      // Success — optionally push
      const shouldPush = await api.showInputPrompt(
        "Push merged branch before archiving? (yes/no)",
        "yes",
      );
      if (shouldPush?.toLowerCase() === "yes") {
        try {
          await api.invoke("push_branch", {
            repoPath: entry.repoPath,
            branch: entry.baseBranch,
          });
        } catch {
          // Non-fatal — push failure doesn't block archive
        }
      }

      // Remove worktree
      try {
        await api.invoke("remove_worktree", {
          repoPath: entry.repoPath,
          worktreePath: entry.worktreePath,
        });
      } catch {
        // Non-fatal — worktree may already be gone
      }

      // Emit merged event
      api.emit("extension:worktree:merged", {
        worktreePath: entry.worktreePath,
        branch: entry.branch,
        baseBranch: entry.baseBranch,
        repoPath: entry.repoPath,
        workspaceId: entry.workspaceId || "",
      });

      // Remove from state
      const remaining = entries.filter((e) => e.branch !== selected.trim());
      saveWorktreeWorkspaces(api, remaining);
    });
  });

  api.onDeactivate(() => {
    api.off("workspace:created", onWorkspaceCreated);
    api.off("workspace:closed", onWorkspaceClosed);
  });
}
