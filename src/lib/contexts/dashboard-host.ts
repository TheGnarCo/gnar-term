/**
 * DashboardHostContext — a uniform surface exposed to every dashboard
 * body (real dashboard nestedWorkspaces + pseudo-nestedWorkspaces) so embedded
 * widgets derive their scope from a single shape.
 *
 * Real dashboard nestedWorkspaces expose their own `workspace.metadata` via
 * this context. The Global Agentic Dashboard pseudo-workspace provides
 * a synthetic context with `metadata = { isGlobalAgenticDashboard: true }`.
 * Widgets (`gnar:agent-list`, `gnar:kanban`, `gnar:task-spawner`) read
 * from this context via `getDashboardHost()` and never need props
 * threaded through markdown.
 *
 * Scope derivation inside widgets:
 *   - `metadata.isGlobalAgenticDashboard === true` → { kind: "global" }
 *   - `metadata.parentWorkspaceId` present                   → { kind: "workspace", parentWorkspaceId }
 *   - Otherwise                                     → inert / error
 */
import { getContext, setContext } from "svelte";
import type { NestedWorkspaceMetadata } from "../types";

export interface DashboardHostContext {
  /**
   * Metadata describing the host: the real workspace.metadata for an
   * actual dashboard workspace, or the synthetic metadata the
   * pseudo-workspace registry carried for a virtual host.
   */
  metadata: NestedWorkspaceMetadata;
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
  | { kind: "workspace"; parentWorkspaceId: string }
  | { kind: "none" };

/**
 * Derive the widget scope from a host context's metadata. Widgets call
 * this instead of reading metadata fields directly so the rules stay
 * consistent across widget implementations.
 *
 * Returns `{ kind: "none" }` when neither `isGlobalAgenticDashboard`
 * nor a string `parentWorkspaceId` is present — callers should treat that as
 * "host has no scope" (typically render empty).
 */
export function deriveDashboardScope(
  host: DashboardHostContext | null,
): DashboardScope {
  if (!host) return { kind: "none" };
  const md = host.metadata;
  if (md.isGlobalAgenticDashboard === true) {
    return { kind: "global" };
  }
  const parentWorkspaceId = md.parentWorkspaceId;
  if (typeof parentWorkspaceId === "string" && parentWorkspaceId.length > 0) {
    return { kind: "workspace", parentWorkspaceId };
  }
  return { kind: "none" };
}
