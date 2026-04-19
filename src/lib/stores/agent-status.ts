/**
 * Agent Status Store — maps workspace IDs to their aggregate agent status.
 *
 * Populated by the agentic-orchestrator extension when harness status
 * changes. Read by WorkspaceItem to render status indicator dots.
 *
 * Now delegates to the status registry with source="_agent" and
 * category="process". The public API shape (Record<string, string>)
 * is preserved for backwards compatibility.
 */
import { derived, type Readable } from "svelte/store";
import {
  statusRegistry,
  setStatusItem,
  clearStatusItem,
  unregisterStatusBySource,
} from "../services/status-registry";

const AGENT_SOURCE = "_agent";
const AGENT_ITEM_ID = "default";
const AGENT_CATEGORY = "process";

function severityFor(status: string): number {
  switch (status) {
    case "running":
      return 3;
    case "waiting":
      return 2;
    case "idle":
      return 1;
    default:
      return 0;
  }
}

/**
 * Derived store that projects _agent registry items into the legacy
 * Record<string, string> shape. For each workspace with an _agent
 * process item, emits the label (status string) of the highest-severity item.
 */
export const agentStatusStore: Readable<Record<string, string>> = derived(
  statusRegistry.store,
  ($items) => {
    const result: Record<string, string> = {};
    for (const item of $items) {
      if (item.source !== AGENT_SOURCE || item.category !== AGENT_CATEGORY) {
        continue;
      }
      const existing = result[item.workspaceId];
      if (!existing || severityFor(item.label) > severityFor(existing)) {
        result[item.workspaceId] = item.label;
      }
    }
    return result;
  },
);

export function setAgentStatus(workspaceId: string, status: string): void {
  setStatusItem(AGENT_SOURCE, workspaceId, AGENT_ITEM_ID, {
    category: AGENT_CATEGORY,
    priority: 0,
    label: status,
    variant:
      status === "running"
        ? "success"
        : status === "waiting"
          ? "warning"
          : "muted",
  });
}

export function clearAgentStatus(workspaceId: string): void {
  clearStatusItem(AGENT_SOURCE, workspaceId, AGENT_ITEM_ID);
}

export function resetAgentStatuses(): void {
  unregisterStatusBySource(AGENT_SOURCE);
}
