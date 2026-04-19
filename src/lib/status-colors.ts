import type { StatusItem } from "./types/status";

const VARIANT_COLORS: Record<string, string> = {
  success: "#4ec957",
  warning: "#e8b73a",
  error: "#e85454",
  muted: "#888888",
};

/**
 * Returns the CSS color for a status variant.
 * "default" and undefined use `fallback` (typically a theme color like fgMuted).
 */
export function variantColor(
  variant: StatusItem["variant"],
  fallback: string = "inherit",
): string {
  if (!variant || variant === "default") return fallback;
  return VARIANT_COLORS[variant] ?? fallback;
}

export interface AgentBadge {
  label: string;
  count: number;
  color: string;
  variant: StatusItem["variant"];
}

/**
 * Aggregates process status items into badge descriptors.
 * Returns badges sorted: running first, then waiting, then idle.
 */
export function aggregateAgentBadges(processItems: StatusItem[]): AgentBadge[] {
  const groups = new Map<
    string,
    { count: number; variant: StatusItem["variant"] }
  >();

  for (const item of processItems) {
    const v = item.variant ?? "default";
    const existing = groups.get(v);
    if (existing) {
      existing.count++;
    } else {
      groups.set(v, { count: 1, variant: item.variant });
    }
  }

  const order: StatusItem["variant"][] = [
    "success",
    "warning",
    "muted",
    "error",
    "default",
  ];
  const labels: Record<string, string> = {
    success: "running",
    warning: "waiting",
    muted: "idle",
    error: "error",
    default: "unknown",
  };

  const badges: AgentBadge[] = [];
  for (const v of order) {
    const key = v ?? "default";
    const group = groups.get(key);
    if (group) {
      badges.push({
        label: `${group.count} ${labels[key] ?? key}`,
        count: group.count,
        color: variantColor(group.variant),
        variant: group.variant,
      });
    }
  }

  return badges;
}

/**
 * Returns the highest-severity agent dot color for a given pane from process status items.
 * Priority: error > running (success) > waiting (warning). Idle returns null (no dot).
 */
export function agentDotColorForPane(
  processItems: StatusItem[],
  paneId: string,
): string | null {
  const paneItems = processItems.filter(
    (item) => item.metadata?.paneId === paneId,
  );
  if (paneItems.length === 0) return null;

  // Severity ordering: error > success (running) > warning (waiting)
  const severityOrder: StatusItem["variant"][] = [
    "error",
    "success",
    "warning",
  ];
  for (const v of severityOrder) {
    if (paneItems.some((item) => item.variant === v)) {
      return variantColor(v);
    }
  }

  // All idle or default — no dot
  return null;
}

/**
 * Returns the agent dot color for a specific surface from process status items.
 * Looks for items with metadata.surfaceId matching the given surfaceId.
 */
export function agentDotColorForSurface(
  processItems: StatusItem[],
  surfaceId: string,
): string | null {
  const item = processItems.find((i) => i.metadata?.surfaceId === surfaceId);
  if (!item) return null;
  if (item.variant === "muted") return null; // idle — no dot
  return variantColor(item.variant);
}

/**
 * Returns the agent status label (e.g. "running", "waiting") for a surface.
 */
export function agentStatusForSurface(
  processItems: StatusItem[],
  surfaceId: string,
): string | null {
  const item = processItems.find((i) => i.metadata?.surfaceId === surfaceId);
  return item?.label ?? null;
}
