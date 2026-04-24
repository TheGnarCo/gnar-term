/**
 * v2 Workspace Groups Unification migration — collapses the legacy
 * AgentOrchestrator entity into the new Workspace-Group-scoped Agentic
 * Dashboard contribution and the singleton Global Agentic Dashboard.
 *
 * Runs once per config (schemaVersion 1 → 2). Reads the workspace-groups
 * extension state from disk to resolve each group's `path`, then:
 *
 *   - For each group with ≥1 nested orchestrator (parentGroupId match):
 *     the first orchestrator's markdown is copied to
 *     `<group.path>/.gnar-term/agentic-dashboard.md` (target wins on
 *     conflict). Additional nested orchestrators on the same group are
 *     logged and dropped — the spec caps Agentic Dashboards at one per
 *     group.
 *
 *   - For rootless orchestrators (no parentGroupId): the first one's
 *     markdown is copied to `~/.config/gnar-term/global-agents.md` (the
 *     default Global Agentic Dashboard path) and recorded in
 *     `config.agenticGlobal.markdownPath`. Additional rootless
 *     orchestrators are logged and dropped.
 *
 *   - `config.agentOrchestrators` is deleted.
 *
 * File I/O is best-effort: missing markdown files are skipped with a
 * warning so a partially broken install doesn't prevent the schema bump.
 * The migration still mutates the config shape so subsequent loads
 * don't reprocess.
 */
import { invoke } from "@tauri-apps/api/core";
import { getHome } from "../service-helpers";
import type { GnarTermConfig } from "../../config";

/**
 * Shape of the config-as-written-by-older-releases that this migration
 * consumes. `agentOrchestrators` is removed from the public
 * `GnarTermConfig` type; migrations reach for the legacy field via
 * this structural cast.
 */
interface LegacyConfigShape extends GnarTermConfig {
  agentOrchestrators?: LegacyOrchestrator[];
}

/**
 * Structural description of a workspace group — mirrors the
 * `WorkspaceGroupEntry` in core but kept here to avoid a runtime import
 * dependency on the public config type. The migration only needs
 * `{ id, path }`.
 */
interface LegacyWorkspaceGroup {
  id: string;
  path: string;
}

interface LegacyOrchestrator {
  id: string;
  name?: string;
  baseDir?: string;
  color?: string;
  path: string;
  parentGroupId?: string;
  dashboardWorkspaceId?: string;
  createdAt?: string;
}

const WORKSPACE_GROUPS_STATE_PATHS = [
  // Current path (post-Stage-2b rename).
  "extensions/workspace-groups/state.json",
  // Legacy path (pre-rename) — fall through when the new file is absent
  // on installs that predate the extension-id migration.
  "extensions/project-scope/state.json",
];

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const content = await invoke<string>("read_file", { path });
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function readWorkspaceGroups(
  home: string,
): Promise<LegacyWorkspaceGroup[]> {
  for (const rel of WORKSPACE_GROUPS_STATE_PATHS) {
    const path = `${home}/.config/gnar-term/${rel}`;
    const state = await readJson<Record<string, unknown>>(path);
    if (!state) continue;
    const groups =
      (state.workspaceGroups as LegacyWorkspaceGroup[] | undefined) ??
      (state.projects as LegacyWorkspaceGroup[] | undefined);
    if (Array.isArray(groups)) return groups;
  }
  return [];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>("file_exists", { path });
  } catch {
    return false;
  }
}

async function moveMarkdown(
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  const sourceContent = await readRaw(sourcePath);
  if (sourceContent === null) {
    console.warn(
      `[migration v2] Skipping markdown move — source missing: ${sourcePath}`,
    );
    return false;
  }
  // Destination must not already exist — spec says "target wins" so we
  // preserve any file the user already has at the destination.
  if (await fileExists(targetPath)) {
    console.warn(
      `[migration v2] Target already exists, leaving it intact: ${targetPath}`,
    );
    return false;
  }
  const dir = targetPath.replace(/\/[^/]+$/, "");
  try {
    await invoke("ensure_dir", { path: dir });
    await invoke("write_file", { path: targetPath, content: sourceContent });
    return true;
  } catch (err) {
    console.warn(
      `[migration v2] Failed to write ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

async function readRaw(path: string): Promise<string | null> {
  try {
    return await invoke<string>("read_file", { path });
  } catch {
    return null;
  }
}

function groupByParent(orchestrators: LegacyOrchestrator[]): {
  nestedByGroup: Map<string, LegacyOrchestrator[]>;
  rootless: LegacyOrchestrator[];
} {
  const nestedByGroup = new Map<string, LegacyOrchestrator[]>();
  const rootless: LegacyOrchestrator[] = [];
  for (const o of orchestrators) {
    if (o.parentGroupId) {
      const list = nestedByGroup.get(o.parentGroupId) ?? [];
      list.push(o);
      nestedByGroup.set(o.parentGroupId, list);
    } else {
      rootless.push(o);
    }
  }
  return { nestedByGroup, rootless };
}

/**
 * Apply the workspace-groups unification migration to `config`. Returns
 * the next config shape with `agentOrchestrators` removed and
 * `agenticGlobal.markdownPath` populated where applicable. Side-effects
 * (markdown file moves) run via `invoke` and are best-effort.
 */
export async function migrateV2WorkspaceGroupsUnification(
  config: GnarTermConfig,
): Promise<GnarTermConfig> {
  const legacyConfig = config as LegacyConfigShape;
  const orchestrators = legacyConfig.agentOrchestrators ?? [];
  if (orchestrators.length === 0) {
    const { agentOrchestrators: _drop, ...rest } = legacyConfig;
    void _drop;
    return rest as GnarTermConfig;
  }

  const home = await getHome();
  const groups = await readWorkspaceGroups(home);
  const groupPathById = new Map(groups.map((g) => [g.id, g.path]));

  const { nestedByGroup, rootless } = groupByParent(orchestrators);

  // Nested: first per group migrates; rest are logged + dropped.
  for (const [groupId, list] of nestedByGroup) {
    const [first, ...extras] = list;
    if (!first) continue;
    const groupPath = groupPathById.get(groupId);
    if (!groupPath) {
      console.warn(
        `[migration v2] Group ${groupId} not found in extension state; ` +
          `keeping orchestrator markdown at ${first.path} for manual rescue.`,
      );
    } else {
      const target = `${groupPath.replace(/\/+$/, "")}/.gnar-term/agentic-dashboard.md`;
      await moveMarkdown(first.path, target);
    }
    if (extras.length > 0) {
      console.warn(
        `[migration v2] Dropping ${extras.length} extra nested orchestrator(s) ` +
          `for group ${groupId}: ${extras.map((o) => o.id).join(", ")}. ` +
          `Their markdown remains at its old path for manual rescue.`,
      );
    }
  }

  // Rootless: first becomes the Global Agentic Dashboard source; rest dropped.
  const nextAgenticGlobal = { ...(config.agenticGlobal ?? {}) };
  if (rootless.length > 0) {
    const [first, ...extras] = rootless;
    const defaultGlobalPath = `${home}/.config/gnar-term/global-agents.md`;
    const targetPath = nextAgenticGlobal.markdownPath ?? defaultGlobalPath;
    if (first) {
      await moveMarkdown(first.path, targetPath);
      if (!nextAgenticGlobal.markdownPath) {
        nextAgenticGlobal.markdownPath = targetPath;
      }
    }
    if (extras.length > 0) {
      console.warn(
        `[migration v2] Dropping ${extras.length} extra rootless orchestrator(s): ` +
          `${extras.map((o) => o.id).join(", ")}. ` +
          `Their markdown remains at its old path for manual rescue.`,
      );
    }
  }

  const { agentOrchestrators: _removed, ...rest } = legacyConfig;
  void _removed;
  const next: GnarTermConfig = {
    ...(rest as GnarTermConfig),
    agenticGlobal: nextAgenticGlobal,
  };
  return next;
}
