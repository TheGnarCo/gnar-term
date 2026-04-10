/**
 * Managed Workspaces — included extension
 *
 * Git worktree-backed workspace management. Creates worktrees, opens them
 * as workspaces, and archives them when done.
 */
import type {
  ExtensionManifest,
  ExtensionAPI,
} from "../../lib/extension-types";
import ManagedWorkspacesList from "./ManagedWorkspacesList.svelte";

export interface ManagedWorkspaceEntry {
  workspaceId: string;
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
      {
        id: "create-worktree-workspace",
        title: "Create Worktree Workspace...",
      },
      { id: "archive-workspace", title: "Archive Managed Workspace..." },
    ],
    primarySidebarSections: [
      { id: "managed-workspaces", label: "Managed Workspaces" },
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
    api.registerPrimarySidebarSection(
      "managed-workspaces",
      ManagedWorkspacesList,
    );

    api.registerCommand("create-worktree-workspace", async () => {
      const activeCwd = await api.getActiveCwd();

      const repoPath = await api.showInputPrompt(
        "Repository path",
        activeCwd || "",
      );
      if (!repoPath) return;

      const prefix = api.getSetting<string>("branchPrefix") || "";

      const branchName = await api.showInputPrompt("Branch name", prefix);
      if (!branchName) return;

      const baseBranch = await api.showInputPrompt("Base branch", "main");
      if (!baseBranch) return;

      const worktreePath = `${repoPath}/../${branchName}`;

      await api.invoke("create_worktree", {
        repo_path: repoPath,
        branch: branchName,
        base: baseBranch,
        worktree_path: worktreePath,
      });

      const copyPatterns = api.getSetting<string>("copyPatterns") || "";
      if (copyPatterns.trim()) {
        const patterns = copyPatterns
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        await api.invoke("copy_files", {
          source_dir: repoPath,
          dest_dir: worktreePath,
          patterns,
        });
      }

      const setupScript = api.getSetting<string>("setupScript") || "";
      if (setupScript.trim()) {
        await api.invoke("run_script", {
          cwd: worktreePath,
          command: setupScript.trim(),
        });
      }

      api.createWorkspace(branchName, worktreePath, {
        metadata: {
          worktreePath,
          branch: branchName,
          baseBranch,
          repoPath,
        },
      });

      const entries = getManagedWorkspaces(api);
      const newEntry: ManagedWorkspaceEntry = {
        workspaceId: branchName,
        worktreePath,
        branch: branchName,
        baseBranch,
        repoPath,
        createdAt: new Date().toISOString(),
      };
      saveManagedWorkspaces(api, [...entries, newEntry]);
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
