import { get } from "svelte/store";
import type { ExtensionAPI } from "../../api";

/**
 * Derive the worktree path from a repo path and a branch name.
 * Pattern: `<parent-of-repo>/<repo-basename>-<branch-hyphenated>`.
 * Mirrors the private helper in mcp-tools/agentic-core.ts without importing it.
 */
function deriveWorktreePath(repoPath: string, branch: string): string {
  const normalised = repoPath.replace(/[/\\]+$/, "");
  const parts = normalised.split(/[/\\]/);
  const repoName = parts[parts.length - 1] ?? "repo";
  const parent = parts.slice(0, -1).join("/") || "/";
  const safeBranch = branch.replace(/[/\\]/g, "-");
  return `${parent}/${repoName}-${safeBranch}`;
}

/**
 * Open a multi-step form to spawn a new agentic branch.
 *
 * Deviation from intent.md AC-3:
 *   The intent references `api.invoke("spawn_branch", ...)` but `spawn_branch`
 *   is an MCP tool, not a Tauri command. Instead this flow uses:
 *     1. `api.invoke("create_worktree", ...)` to materialize the worktree.
 *     2. `api.createWorkspaceFromDef(...)` to create the Branch workspace and
 *        auto-run the chosen AgentPreset command inside it.
 *   This reaches the same end state without adding a new core API.
 */
export async function openSpawnBranchFlow(api: ExtensionAPI): Promise<void> {
  // Step a: read current presets
  const presets = get(api.agentPresets);

  // Step b: capture active workspace + cwd. The active workspace id is
  // forwarded as `rootWorkspaceId` so the spawned workspace is attached
  // as a Branch of the triggering workspace rather than a standalone root.
  const activeWs = get(api.activeWorkspace);
  let repoPath: string | null | undefined;
  try {
    repoPath = await api.getActiveCwd();
  } catch (err) {
    api.reportError("Cannot spawn agentic branch: " + (err as Error).message);
    return;
  }
  if (!repoPath) {
    api.reportError("Cannot spawn agentic branch: no active workspace cwd");
    return;
  }

  // Step c: build field list dynamically
  type FormField =
    | {
        key: string;
        label: string;
        type?: "text";
        defaultValue?: string;
        placeholder?: string;
      }
    | {
        key: string;
        label: string;
        type: "select";
        options: Array<{ label: string; value: string }>;
        defaultValue?: string;
      }
    | { key: string; label: string; type: "info"; defaultValue?: string };

  const fields: FormField[] = [
    {
      key: "name",
      label: "Branch name",
      type: "text" as const,
      placeholder: "feat/my-branch",
    },
    {
      key: "base",
      label: "Base branch",
      type: "text" as const,
      defaultValue: "main",
    },
  ];

  if (presets.length > 0) {
    fields.push({
      key: "preset",
      label: "Agent preset",
      type: "select" as const,
      options: presets.map((p) => ({ label: p.name, value: p.name })),
    });
  } else {
    fields.push({
      key: "noPresets",
      label:
        "No agent presets configured yet. The branch will be created without an agent. Use the AgentPreset library to add one.",
      type: "info" as const,
    });
  }

  // Step d: show form
  const result = await api.showFormPrompt("New agentic branch", fields);
  if (result === null) return;

  // Step e: validate name
  const name = result.name?.trim() ?? "";
  if (!name) {
    api.reportError("Branch name cannot be empty.");
    return;
  }

  const worktreePath = deriveWorktreePath(repoPath, name);

  // Step f: create the worktree
  try {
    await api.invoke("create_worktree", {
      repoPath,
      branch: name,
      base: result.base?.trim() || "main",
      worktreePath,
    });
  } catch (err) {
    api.reportError(
      "Failed to create agentic branch: " + (err as Error).message,
    );
    return;
  }

  // Step g/h: resolve preset and create workspace
  const chosenPreset = presets.find((p) => p.name === result.preset) ?? null;

  const surface: Record<string, unknown> = { type: "terminal" };
  if (chosenPreset) {
    surface.command = chosenPreset.command;
    if (chosenPreset.env) surface.env = chosenPreset.env;
  }

  try {
    await api.createWorkspaceFromDef({
      name,
      cwd: worktreePath,
      ...(activeWs?.id ? { rootWorkspaceId: activeWs.id } : {}),
      layout: {
        pane: {
          surfaces: [
            surface as {
              type: "terminal";
              command?: string;
              env?: Record<string, string>;
            },
          ],
        },
      },
    });
  } catch (err) {
    api.reportError(
      "Failed to create agentic branch: " + (err as Error).message,
    );
  }
}
