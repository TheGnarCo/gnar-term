/**
 * Dashboard Contribution Registry — extensions (and core) register
 * "kinds of dashboard" that can be added to a Workspace. Each
 * contribution knows how to create its own Dashboard workspace from a
 * workspace; the workspace's multi-dashboard grid renders the resulting
 * nestedWorkspaces keyed off `metadata.dashboardContributionId`.
 */
import { get, type Readable } from "svelte/store";
import { createRegistry } from "./create-registry";
import type { Workspace } from "../config";

/**
 * Stable persisted id for the built-in Workspace overview dashboard.
 * The string `"group"` predates the Workspace/NestedWorkspace rename and
 * is preserved verbatim — it's stamped onto every overview dashboard
 * workspace's `metadata.dashboardContributionId` and survives across
 * upgrades. Tests, fixtures, and unrelated `spawnedBy.kind: "group"`
 * literals do NOT use this constant.
 */
export const OVERVIEW_DASHBOARD_CONTRIBUTION_ID = "group";

/**
 * A kind of dashboard that can attach to a Workspace. The
 * registry stores the declarative metadata; workspace actions ("Add
 * <Dashboard>", "Remove <Dashboard>") read from it to build their menus,
 * and the core Workspace lifecycle code calls `create` to materialize the
 * backing workspace on demand.
 */
export interface DashboardContribution {
  /**
   * Stable identifier, also stamped onto the dashboard workspace as
   * `metadata.dashboardContributionId`. Core's built-in uses `"group"`
   * (preserved across the Workspace→NestedWorkspace rename for
   * persisted-data compatibility); the agentic extension uses
   * `"agentic"`. Unique across all contributions.
   */
  id: string;
  /**
   * Extension id (or `"core"`) that registered the contribution.
   * `unregisterBySource` tears down an extension's contributions on
   * deactivate.
   */
  source: string;
  /**
   * Short noun rendered on the dashboard tile (e.g. "Workspace Dashboard",
   * "Agentic Dashboard"). The multi-dashboard grid displays this as
   * the tile label when tiles are wide enough.
   */
  label: string;
  /**
   * Verbed label used for the workspace's context-menu action (e.g. "Add
   * Agentic Dashboard"). Prefer this over synthesizing from `label`
   * so contributions can tune the phrasing.
   */
  actionLabel: string;
  /**
   * Maximum number of this contribution's dashboards that may coexist
   * inside a single workspace. `1` means exclusive (agentic) and
   * `Number.POSITIVE_INFINITY` allows unlimited. Enforced at
   * "Add <Dashboard>" time via `canAddContributionToWorkspace`.
   */
  capPerWorkspace: number;
  /**
   * Materialize a dashboard workspace for `workspace`. Writes any backing
   * markdown, creates the workspace via core services, and returns the
   * new workspace's id. Callers stamp `metadata.dashboardContributionId
   * = contribution.id` on the created workspace so the grid can
   * attribute tiles back to their contribution.
   */
  create: (workspace: Workspace) => Promise<string>;
  /**
   * Optional "delete and regenerate" hook surfaced as a button next to
   * the dashboard's row in Workspace Settings. Implementations typically
   * force-rewrite their backing markdown so a stale user file picks up
   * a newer seeded template. Contributions without backing state
   * (e.g. Diff, Settings) omit this; the button does not render.
   *
   * The preview-surface file watcher reloads markdown on rewrite, so
   * implementations rarely need to close / recreate the host workspace.
   */
  regenerate?: (workspace: Workspace) => Promise<void>;
  /**
   * Optional availability gate. When returns false, the contribution
   * is hidden from the workspace's "Add Dashboard" menu — e.g. the core
   * Workspace Dashboard contribution uses this to hide itself when the
   * user has toggled `workspaceDashboardEnabled` off.
   */
  isAvailableFor?: (workspace: Workspace) => boolean;
  /**
   * Optional icon component rendered on the dashboard tile. When
   * omitted, WorkspaceListView falls back to a generic grid glyph.
   * Tiles are icon-only (no label) — the workspace name is surfaced
   * as the tile's `title` attribute.
   */
  icon?: unknown;
  /**
   * When true, the contribution materializes automatically for every
   * workspace (on workspace creation and startup reconciliation) and
   * cannot be removed by the user. `autoProvision` also hides the
   * contribution from "Add Dashboard" menus and suppresses the
   * per-tile Delete action.
   */
  autoProvision?: boolean;
  /**
   * Hints for how PaneView should render the dashboard workspace.
   * `singleSurface: true` marks the pane as tab-less / split-less —
   * the existing `metadata.isDashboard` check already hides TabBar,
   * so this flag is informational today but documents contributions
   * whose surface type does not accumulate.
   */
  paneConstraints?: { singleSurface?: boolean };
  /**
   * Human-readable reason the toggle is locked, surfaced in the
   * Settings dashboard's per-workspace toggle list. Typically set
   * alongside `autoProvision: true`.
   */
  lockedReason?: string;
}

const registry = createRegistry<DashboardContribution>();

export const dashboardContributionStore: Readable<DashboardContribution[]> =
  registry.store;
export const registerDashboardContribution = registry.register;
export const unregisterDashboardContribution = registry.unregister;
export const unregisterDashboardContributionsBySource =
  registry.unregisterBySource;
export const getDashboardContribution = registry.get;
export const resetDashboardContributions = registry.reset;

/** All registered contributions, in registration order. */
export function getDashboardContributions(): DashboardContribution[] {
  return get(dashboardContributionStore);
}

/**
 * Contributions that are available for `workspace` right now — applies
 * each contribution's optional `isAvailableFor` gate and drops those
 * that return false. Stable registration order is preserved.
 */
export function getDashboardContributionsForWorkspace(
  workspace: Workspace,
): DashboardContribution[] {
  return getDashboardContributions().filter(
    (c) => c.isAvailableFor?.(workspace) ?? true,
  );
}

/**
 * True when the workspace can still accept another dashboard of kind
 * `contributionId`. `currentCount` is the caller's tally of existing
 * dashboard nestedWorkspaces in the workspace whose
 * `metadata.dashboardContributionId === contributionId` — the registry
 * does not track nestedWorkspaces itself, so the caller owns the count.
 *
 * Returns false when: the contribution isn't registered, the
 * availability gate denies the workspace, or `currentCount >= capPerWorkspace`.
 */
export function canAddContributionToWorkspace(
  workspace: Workspace,
  contributionId: string,
  currentCount: number,
): boolean {
  const contribution = getDashboardContribution(contributionId);
  if (!contribution) return false;
  if (contribution.isAvailableFor && !contribution.isAvailableFor(workspace)) {
    return false;
  }
  return currentCount < contribution.capPerWorkspace;
}
