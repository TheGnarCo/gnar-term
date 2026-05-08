/**
 * Per-repo Spacebase config — `<workspacePath>/.gnar-term/spacebase.json`.
 *
 * Mirrors the existing `<workspacePath>/.gnar-term/workspace.json` pattern
 * (see `applyRepoDef` in init-workspaces.ts) so a repo can declare which
 * Spacebase project its docs belong to. The per-workspace dashboard reads
 * this on mount and prefers it over the auth-store's resolved project id;
 * the picker UI writes it on user choice so the association sticks.
 *
 * Pure data layer — host bindings (filesystem, json) flow in via the
 * `RepoConfigDeps` adapter so tests can drive the helpers without touching
 * Tauri.
 */
export interface SpacebaseRepoConfig {
  projectId?: string;
}

export interface RepoConfigDeps {
  fileExists: (path: string) => Promise<boolean>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  ensureDir: (path: string) => Promise<void>;
}

/** Path to the per-repo config inside `<workspacePath>/.gnar-term/`. */
export function repoConfigPath(workspacePath: string): string {
  return `${workspacePath.replace(/\/+$/, "")}/.gnar-term/spacebase.json`;
}

function repoConfigDir(workspacePath: string): string {
  return `${workspacePath.replace(/\/+$/, "")}/.gnar-term`;
}

/**
 * Load the per-repo config; returns null when the file doesn't exist or
 * fails to parse. Failure to parse is treated as "no config" so a
 * malformed file doesn't brick the dashboard — the picker UI lets the
 * user re-write it.
 */
export async function loadRepoConfig(
  deps: RepoConfigDeps,
  workspacePath: string,
): Promise<SpacebaseRepoConfig | null> {
  const path = repoConfigPath(workspacePath);
  if (!(await deps.fileExists(path))) return null;
  try {
    const raw = await deps.readFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const projectId =
      typeof obj.projectId === "string" && obj.projectId.length > 0
        ? obj.projectId
        : undefined;
    return { projectId };
  } catch {
    return null;
  }
}

/**
 * Write the per-repo config, creating `.gnar-term/` if needed. Stable
 * 2-space JSON formatting + trailing newline so committed configs diff
 * cleanly against subsequent edits.
 */
export async function writeRepoConfig(
  deps: RepoConfigDeps,
  workspacePath: string,
  config: SpacebaseRepoConfig,
): Promise<void> {
  await deps.ensureDir(repoConfigDir(workspacePath));
  const body = `${JSON.stringify(config, null, 2)}\n`;
  await deps.writeFile(repoConfigPath(workspacePath), body);
}
