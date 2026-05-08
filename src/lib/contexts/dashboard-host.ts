/**
 * DashboardHostContext — a uniform surface exposed to every dashboard
 * body (real dashboard workspaces + pseudo-workspaces) so embedded
 * widgets derive their scope from a single shape.
 *
 * Real dashboard workspaces project their structural fields (e.g.
 * `{ rootWorkspaceId }`) into this context. The Global Agentic
 * Dashboard pseudo-workspace provides a synthetic context with
 * `metadata = { isGlobalAgenticDashboard: true }`. Embedded components
 * (AgentList, Kanban, TaskSpawner, Issues, PRs) read from this context
 * via `getDashboardHost()` and never need props threaded through.
 *
 * Scope derivation inside widgets:
 *   - `metadata.isGlobalAgenticDashboard === true` → { kind: "global" }
 *   - `metadata.rootWorkspaceId` present           → { kind: "workspace", rootWorkspaceId }
 *   - Otherwise                                    → inert / error
 */
import { getContext, setContext } from "svelte";

export interface DashboardHostContext {
  /**
   * Metadata describing the host. For a real dashboard workspace, callers
   * pass a projection of the workspace's structural fields (e.g.
   * `{ rootWorkspaceId }`); for a pseudo-workspace, callers pass the
   * synthetic shape from `PseudoWorkspaceInput.metadata` (e.g.
   * `{ isGlobalAgenticDashboard: true }`).
   */
  metadata: Record<string, unknown>;
}

/** Svelte context key. Scoped string to avoid collisions. */
export const DASHBOARD_HOST_KEY = "gnar-term:dashboard-host";

/**
 * Provider — call inside a component that mounts a dashboard body
 * (real or pseudo). Children fetch the context via
 * `getDashboardHost()`.
 */
export function setDashboardHost(host: DashboardHostContext): void {
  setContext<DashboardHostContext>(DASHBOARD_HOST_KEY, host);
}

/**
 * Consumer — returns the host context set by the nearest ancestor, or
 * `null` when no ancestor has set one (widget outside a dashboard body).
 * Widgets decide how to react: agent-list renders empty, task-spawner
 * disables itself, etc.
 */
export function getDashboardHost(): DashboardHostContext | null {
  const ctx = getContext<DashboardHostContext | undefined>(DASHBOARD_HOST_KEY);
  return ctx ?? null;
}

// --- Scope helpers (derived from the host metadata) ---

export type DashboardScope =
  | { kind: "global" }
  | { kind: "workspace"; rootWorkspaceId: string }
  | { kind: "none" };

/**
 * Derive the widget scope from a host context's metadata. Widgets call
 * this instead of reading metadata fields directly so the rules stay
 * consistent across widget implementations.
 *
 * Returns `{ kind: "none" }` when neither `isGlobalAgenticDashboard`
 * nor a string `rootWorkspaceId` is present — callers should treat that
 * as "host has no scope" (typically render empty).
 */
export function deriveDashboardScope(
  host: DashboardHostContext | null,
): DashboardScope {
  if (!host) return { kind: "none" };
  const md = host.metadata;
  if (md.isGlobalAgenticDashboard === true) {
    return { kind: "global" };
  }
  const rootWorkspaceId =
    typeof md.rootWorkspaceId === "string" ? md.rootWorkspaceId : undefined;
  if (typeof rootWorkspaceId === "string" && rootWorkspaceId.length > 0) {
    return { kind: "workspace", rootWorkspaceId };
  }
  return { kind: "none" };
}
