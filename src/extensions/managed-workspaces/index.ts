/**
 * Managed Workspaces — included extension
 *
 * Git worktree-backed workspace management. Creates worktrees, opens them
 * as workspaces, and archives them when done. Uses workspace actions
 * instead of a sidebar section for workspace creation.
 */
import type {
  ExtensionManifest,
  ExtensionAPI,
} from "../../lib/extension-types";

interface ManagedWorkspaceEntry {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  repoPath: string;
  createdAt: string;
}

export const managedWorkspacesManifest: ExtensionManifest = {
  id: "managed-workspaces",
  name: "Managed Workspaces",
  version: "0.1.0",
  description: "Git worktree-backed workspace management",
  entry: "./index.ts",
  included: true,
  contributes: {
    commands: [
      { id: "archive-workspace", title: "Archive Managed Workspace..." },
    ],
    workspaceActions: [
      { id: "create-worktree-workspace", title: "New Managed Workspace" },
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
      },
    },
    events: ["workspace:created", "workspace:closed"],
  },
};

function getManagedWorkspaces(api: ExtensionAPI): ManagedWorkspaceEntry[] {
  return api.state.get<ManagedWorkspaceEntry[]>("managedWorkspaces") || [];
}

function saveManagedWorkspaces(
  api: ExtensionAPI,
  entries: ManagedWorkspaceEntry[],
): void {
  api.state.set("managedWorkspaces", entries);
}

export function registerManagedWorkspacesExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerWorkspaceAction("create-worktree-workspace", {
      label: "New Managed Workspace",
      icon: "git-branch",
      handler: async (ctx) => {
        let repoPath: string | null;

        if (ctx.projectPath) {
          // Called from a project context — use the project root
          repoPath = ctx.projectPath;
        } else {
          // Called from top level — open native directory picker
          repoPath = await api.pickDirectory("Select Git Repository");
          if (!repoPath) return;
        }

        const isGit = await api.invoke<boolean>("is_git_repo", {
          path: repoPath,
        });
        if (!isGit) {
          await api.showInputPrompt(
            `"${repoPath.split("/").pop()}" is not a git repository. Select a folder that contains a .git directory.`,
          );
          return;
        }

        const branch = await api.showInputPrompt("Branch name");
        if (!branch) return;

        const base = await api.showInputPrompt("Base branch", "main");
        if (!base) return;

        // Derive worktree path from repo parent + branch name
        const repoName = repoPath.split("/").pop() || "repo";
        const parentDir = repoPath.substring(0, repoPath.lastIndexOf("/"));
        const worktreePath = `${parentDir}/${repoName}-${branch}`;

        await api.invoke("create_worktree", {
          repo_path: repoPath,
          branch,
          base,
          worktree_path: worktreePath,
        });

        // Copy config files if setting is configured
        const copyPatternsStr = api.getSetting<string>("copyPatterns") || "";
        if (copyPatternsStr.trim()) {
          const patterns = copyPatternsStr
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean);
          if (patterns.length > 0) {
            await api.invoke("copy_files", {
              source_dir: repoPath,
              dest_dir: worktreePath,
              patterns,
            });
          }
        }

        // Run setup script if configured
        const setupScript = api.getSetting<string>("setupScript") || "";
        if (setupScript.trim()) {
          await api.invoke("run_script", {
            cwd: worktreePath,
            command: setupScript,
          });
        }

        // Create the workspace
        api.createWorkspace(branch, worktreePath, {
          env: { GNARTERM_WORKTREE_ROOT: repoPath },
          metadata: { worktreePath, branch, baseBranch: base, repoPath },
        });

        // Save to state
        const entries = getManagedWorkspaces(api);
        entries.push({
          worktreePath,
          branch,
          baseBranch: base,
          repoPath,
          createdAt: new Date().toISOString(),
        });
        saveManagedWorkspaces(api, entries);
      },
      when: (ctx) => {
        // Top level: always show
        if (!ctx.projectId) return true;
        // In project context: only show if project is a git repo
        return ctx.isGit === true;
      },
    });

    api.registerCommand("archive-workspace", async () => {
      const entries = getManagedWorkspaces(api);
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
          repo_path: entry.repoPath,
          branch: entry.branch,
        });
      }

      await api.invoke("remove_worktree", {
        repo_path: entry.repoPath,
        worktree_path: entry.worktreePath,
      });

      const remaining = entries.filter((e) => e.branch !== selected.trim());
      saveManagedWorkspaces(api, remaining);
    });
  });
}
