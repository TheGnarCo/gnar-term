import { get } from "svelte/store";
import type { ExtensionAPI } from "../../api";

interface BranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

interface WorktreeRef {
  path: string;
  head: string;
  branch: string | null;
  is_bare: boolean;
}

interface BaseOption {
  label: string;
  value: string;
  group?: string;
}

/**
 * Build the Source branch picker payload via api.invoke (so the extension
 * stays within its barrier: nothing imported from src/lib). Mirrors the
 * shape of fetchBaseOptions in core's worktree-helpers but uses the
 * extension's invoke proxy. Returns options pre-sorted alphabetically
 * within group, with worktree-occupied branches in a trailing
 * "Worktrees" group.
 */
async function fetchBaseOptionsViaApi(
  api: ExtensionAPI,
  repoPath: string,
): Promise<{ options: BaseOption[]; currentBranch: string | null }> {
  const locals = new Map<string, BaseOption>();
  const remotes = new Map<string, BaseOption>();
  const worktreeNames = new Set<string>();
  let currentBranch: string | null = null;

  try {
    const branches = await api.invoke<BranchInfo[]>("list_branches", {
      repoPath,
      includeRemote: true,
    });
    for (const b of branches ?? []) {
      if (b.is_remote) {
        if (!remotes.has(b.name)) {
          remotes.set(b.name, {
            label: b.name,
            value: b.name,
            group: "Remote",
          });
        }
      } else {
        if (b.is_current) currentBranch = b.name;
        if (!locals.has(b.name)) {
          locals.set(b.name, {
            label: b.is_current ? `${b.name} (current)` : b.name,
            value: b.name,
            group: "Local",
          });
        }
      }
    }
  } catch {
    // list_branches unavailable — caller falls back to text input.
  }

  try {
    const worktrees = await api.invoke<WorktreeRef[]>("list_worktrees", {
      repoPath,
    });
    for (const wt of worktrees ?? []) {
      if (!wt.branch) continue;
      worktreeNames.add(wt.branch);
    }
  } catch {
    // list_worktrees unavailable — non-fatal.
  }

  const byName = (a: BaseOption, b: BaseOption) =>
    a.value.localeCompare(b.value);
  const localOpts: BaseOption[] = [];
  const remoteOpts: BaseOption[] = [];
  const worktreeOpts: BaseOption[] = [];

  for (const opt of locals.values()) {
    if (worktreeNames.has(opt.value)) {
      worktreeOpts.push({ ...opt, group: "Worktrees" });
    } else {
      localOpts.push(opt);
    }
  }
  for (const opt of remotes.values()) {
    if (worktreeNames.has(opt.value)) continue;
    remoteOpts.push(opt);
  }

  localOpts.sort(byName);
  remoteOpts.sort(byName);
  worktreeOpts.sort(byName);

  return {
    options: [...localOpts, ...remoteOpts, ...worktreeOpts],
    currentBranch,
  };
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
        options: Array<{ label: string; value: string; group?: string }>;
        defaultValue?: string;
      }
    | { key: string; label: string; type: "info"; defaultValue?: string };

  // Source branch picker: prefer a grouped select sourced from
  // list_branches / list_worktrees. Fall back to a plain text input when
  // either command is unavailable. Defaults to the current branch.
  const { options: baseOptions, currentBranch } = await fetchBaseOptionsViaApi(
    api,
    repoPath,
  );

  const defaultBase =
    (currentBranch &&
      baseOptions.find((o) => o.value === currentBranch)?.value) ||
    baseOptions.find((o) => o.value === "main")?.value ||
    baseOptions.find((o) => o.value === "master")?.value ||
    baseOptions[0]?.value ||
    currentBranch ||
    "main";

  const baseField: FormField =
    baseOptions.length > 0
      ? {
          key: "base",
          label: "Source branch",
          type: "select" as const,
          options: baseOptions,
          defaultValue: defaultBase,
        }
      : {
          key: "base",
          label: "Source branch",
          type: "text" as const,
          defaultValue: currentBranch ?? "main",
        };

  const fields: FormField[] = [
    {
      key: "name",
      label: "Branch name",
      type: "text" as const,
      placeholder: "feat/my-branch",
    },
    baseField,
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

  const worktreePath = api.deriveWorktreePath(repoPath, name);

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
      worktreePath,
      branch: name,
      baseBranch: result.base?.trim() || "main",
      repoPath,
      controlled: true,
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
