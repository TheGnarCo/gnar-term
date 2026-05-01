/**
 * Pseudo-NestedWorkspace Registry — extensions register non-persisted, pinned
 * entries that render in the root sidebar list alongside real
 * nestedWorkspaces. The canonical use case is the Global Agentic Dashboard
 * (registered by the agentic extension), which appears at the top of
 * the root list, cannot be deleted or renamed, and renders a
 * configurable markdown body.
 */
import { get, type Readable } from "svelte/store";
import { createRegistry } from "./create-registry";
import {
  prependRootRow,
  appendRootRow,
  removeRootRow,
} from "../stores/root-row-order";

/**
 * A virtual "workspace" pinned at a fixed position in the root list.
 * Pseudo-nestedWorkspaces are not stored in `AppState.nestedWorkspaces`; they are
 * rebuilt from the registry on every render and cannot be closed,
 * renamed, or have panes/surfaces added via the normal workspace
 * controls.
 */
export interface PseudoWorkspace {
  /**
   * Stable identifier. Convention is `<extensionId>.<name>` to avoid
   * collisions across extensions (e.g. `"agentic.global"`).
   */
  id: string;
  /**
   * Extension id (or `"core"`) that registered the pseudo-workspace.
   * `unregisterBySource` clears all an extension's entries on
   * deactivate.
   */
  source: string;
  /**
   * Human-readable label for a11y + context-menu surfaces. Not
   * rendered as a title bar — the pseudo-workspace's body owns its own
   * chrome.
   */
  label: string;
  /**
   * Position within the root list:
   *   - `"root-top"`: pinned above real nestedWorkspaces and groups.
   *   - `"root-bottom"`: pinned below every real row.
   * Order within a position bucket follows registration order.
   */
  position: "root-top" | "root-bottom";
  /**
   * Icon component rendered in the root-row entry. Receives no props;
   * consumers size it via CSS.
   */
  icon: unknown;
  /**
   * Body component rendered when the pseudo-workspace is the active
   * surface. Mounted inside a `DashboardHostContext` provider so
   * widgets can read the synthetic host metadata (see
   * `src/lib/contexts/dashboard-host.ts`).
   */
  render: unknown;
  /**
   * Synthetic workspace metadata exposed to the body via
   * `DashboardHostContext`. Mirrors the metadata a real dashboard
   * workspace would carry, so widgets that derive scope from
   * `metadata.isGlobalAgenticDashboard` / `metadata.parentWorkspaceId` work
   * uniformly between pseudo- and real hosts.
   */
  metadata: Record<string, unknown>;
  /**
   * Optional settings component surfaced inside the registering
   * extension's settings page. Used e.g. by the agentic extension to
   * let users point the Global Agentic Dashboard at a custom markdown
   * path.
   */
  settings?: unknown;
  /**
   * Optional component rendered INSIDE the primary-sidebar root row,
   * to the right of the icon, in place of the plain text label. Used
   * by the Global Agentic Dashboard to render a live status-chip grid
   * instead of the static "Agents dashboard" string. Mounted via
   * ExtensionWrapper so it receives the registering extension's `api`
   * (and can subscribe to `api.agents`, `api.nestedWorkspaces`, etc.).
   *
   * The component is rendered inside a tight flex slot — keep its
   * footprint small (40px-ish height, ~60% of the row's inner width).
   * When omitted, the row renders `pseudo.label` as before.
   */
  rowBody?: unknown;
  /**
   * Called after `unregisterPseudoWorkspace` removes the entry; use this to
   * register a reopen affordance or persist the closed state.
   */
  onClose?: () => void;
}

const registry = createRegistry<PseudoWorkspace>();

export const pseudoWorkspaceStore: Readable<PseudoWorkspace[]> = registry.store;

export function registerPseudoWorkspace(pw: PseudoWorkspace): void {
  registry.register(pw);
  if (pw.position === "root-top") {
    prependRootRow({ kind: "pseudo-workspace", id: pw.id });
  } else {
    appendRootRow({ kind: "pseudo-workspace", id: pw.id });
  }
}

export function unregisterPseudoWorkspace(id: string): void {
  registry.unregister(id);
  removeRootRow({ kind: "pseudo-workspace", id });
}

export function unregisterPseudoWorkspacesBySource(source: string): void {
  const toRemove = get(pseudoWorkspaceStore).filter(
    (pw) => pw.source === source,
  );
  registry.unregisterBySource(source);
  for (const pw of toRemove) {
    removeRootRow({ kind: "pseudo-workspace", id: pw.id });
  }
}

export const getPseudoWorkspace = registry.get;
export const resetPseudoWorkspaces = registry.reset;

/** All registered pseudo-nestedWorkspaces, in registration order. */
export function getPseudoWorkspaces(): PseudoWorkspace[] {
  return get(pseudoWorkspaceStore);
}

/**
 * Pseudo-nestedWorkspaces that should render at the top of the root list,
 * in registration order. Returned array is stable across calls until
 * the registry mutates.
 */
export function getRootTopPseudoWorkspaces(): PseudoWorkspace[] {
  return getPseudoWorkspaces().filter((pw) => pw.position === "root-top");
}

/**
 * Pseudo-nestedWorkspaces that should render at the bottom of the root list,
 * in registration order.
 */
export function getRootBottomPseudoWorkspaces(): PseudoWorkspace[] {
  return getPseudoWorkspaces().filter((pw) => pw.position === "root-bottom");
}
