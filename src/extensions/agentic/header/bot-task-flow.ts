import { get } from "svelte/store";
import type { ExtensionAPI, AgentPresetRef } from "../../api";

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

const DEFAULT_PRESETS: AgentPresetRef[] = [
  { name: "Claude Code", command: "claude", intendedAgent: "claude-code" },
  { name: "Codex", command: "codex", intendedAgent: "codex" },
];

function quoteTaskForShell(input: string): string {
  const escaped = input
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(
      /[\x00-\x1f\x7f]/g,
      (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
  return `$'${escaped}'`;
}

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
  } catch (err) {
    console.warn(
      "[bot-task-flow] list_branches failed; falling back to text input:",
      err,
    );
  }

  try {
    const worktrees = await api.invoke<WorktreeRef[]>("list_worktrees", {
      repoPath,
    });
    for (const wt of worktrees ?? []) {
      if (!wt.branch) continue;
      worktreeNames.add(wt.branch);
    }
  } catch (err) {
    console.warn("[bot-task-flow] list_worktrees failed:", err);
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
 * Open a multi-step form to spawn a "Bot Task" — a controlled workspace
 * dedicated to running an agent against a specific task. Differs from the
 * plain spawn-branch flow in three ways: the picker is always populated
 * (built-in defaults fill in when no user presets exist), the dialog has
 * a Task field whose contents are quoted into the preset command as the
 * agent's first argument, and the dialog is titled "New Bot Task".
 */
export async function openBotTaskFlow(api: ExtensionAPI): Promise<void> {
  const userPresets = get(api.agentPresets);
  const presets: AgentPresetRef[] =
    userPresets.length > 0 ? userPresets : DEFAULT_PRESETS;

  const activeWs = get(api.activeWorkspace);
  let repoPath: string | null | undefined;
  try {
    repoPath = await api.getActiveCwd();
  } catch (err) {
    api.reportError("Cannot spawn bot task: " + (err as Error).message);
    return;
  }
  if (!repoPath) {
    api.reportError("Cannot spawn bot task: no active workspace cwd");
    return;
  }

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
      placeholder: "feat/my-bot-task",
    },
    baseField,
    {
      key: "preset",
      label: "Agent preset",
      type: "select" as const,
      options: presets.map((p) => ({ label: p.name, value: p.name })),
    },
    {
      key: "task",
      label: "Task (optional — auto-run as the agent's first prompt)",
      type: "text" as const,
      placeholder: "e.g. Land the auth refactor and open a PR",
    },
  ];

  const result = await api.showFormPrompt("New Bot Task", fields);
  if (result === null) return;

  const name = result.name?.trim() ?? "";
  if (!name) {
    api.reportError("Branch name cannot be empty.");
    return;
  }

  const worktreePath = api.deriveWorktreePath(repoPath, name);

  try {
    await api.invoke("create_worktree", {
      repoPath,
      branch: name,
      base: result.base?.trim() || "main",
      worktreePath,
    });
  } catch (err) {
    api.reportError("Failed to spawn bot task: " + (err as Error).message);
    return;
  }

  const chosenPreset = presets.find((p) => p.name === result.preset) ?? null;

  const task =
    (result.task?.trim() || chosenPreset?.initialPrompt?.trim()) ?? "";

  const surface: Record<string, unknown> = { type: "terminal" };
  if (chosenPreset) {
    surface.command = task
      ? `${chosenPreset.command} ${quoteTaskForShell(task)}`
      : chosenPreset.command;
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
    api.reportError("Failed to spawn bot task: " + (err as Error).message);
  }
}
