/**
 * agent-detection-registry — the canonical list of DetectedAgents.
 *
 * Owns the `_agents` array and the reactive `agentsStore` derived from
 * it. Public selectors (`getAgents`, `getAgentByAgentId`,
 * `getAgentBySurfaceId`) and a test seed (`setAgentsForTests`) are the
 * extension-facing surface. Internal mutation goes through the
 * `_registry` accessor — only the publish + controller slices in this
 * family should import it.
 */
import { writable, type Readable } from "svelte/store";
import type { AgentType } from "./agent-type";

export interface DetectedAgent {
  agentId: string;
  agentName: string;
  /** Typed classification of the agent. Populated from AgentPattern.agentType,
   *  falling back to "generic" when the matched pattern has no agentType. */
  agentType: AgentType;
  surfaceId: string;
  /** Pane hosting the agent's surface. May be null briefly during startup
   *  before the workspace store has loaded the parent pane; backfilled when
   *  the surface→pane mapping becomes known. */
  paneId: string | null;
  workspaceId: string;
  status: string;
  createdAt: string;
  lastStatusChange: string;
}

const _agentsStore = writable<DetectedAgent[]>([]);
export const agentsStore: Readable<DetectedAgent[]> = _agentsStore;

let _agents: DetectedAgent[] = [];
let _idCounter = 0;

function syncStore(): void {
  _agentsStore.set(_agents.slice());
}

export function getAgents(): DetectedAgent[] {
  return _agents.slice();
}

export function getAgentByAgentId(agentId: string): DetectedAgent | undefined {
  return _agents.find((a) => a.agentId === agentId);
}

export function getAgentBySurfaceId(
  surfaceId: string,
): DetectedAgent | undefined {
  return _agents.find((a) => a.surfaceId === surfaceId);
}

/**
 * For tests only — directly inject a snapshot into `_agentsStore`. Lets
 * component tests exercise UI surfaces that derive from the canonical
 * `agentsStore` (rail-attention hat, banner badge) without spinning up
 * the full detection pipeline (PTY chunks, OSC handler, title scanner).
 */
export function setAgentsForTests(agents: DetectedAgent[]): void {
  _agents = agents.slice();
  syncStore();
}

/**
 * Internal mutation surface for the agent-detection-* slice family.
 * Keeps `_agents` private to this module while letting publish/controller
 * push, remove, find, and mutate entries. Not part of the public
 * extension API — do not import from outside this family.
 */
export const _registry = {
  push(agent: DetectedAgent): void {
    _agents.push(agent);
    syncStore();
  },
  removeByAgentId(agentId: string): void {
    _agents = _agents.filter((a) => a.agentId !== agentId);
    syncStore();
  },
  find(agentId: string): DetectedAgent | undefined {
    return _agents.find((a) => a.agentId === agentId);
  },
  filterByWorkspaceId(workspaceId: string): DetectedAgent[] {
    return _agents.filter((a) => a.workspaceId === workspaceId);
  },
  /**
   * Apply `mutator` to the matched agent in-place, then resync the store.
   * Returns `true` when a match was found.
   */
  mutate(agentId: string, mutator: (a: DetectedAgent) => void): boolean {
    const agent = _agents.find((a) => a.agentId === agentId);
    if (!agent) return false;
    mutator(agent);
    syncStore();
    return true;
  },
  reset(): void {
    _agents = [];
    _idCounter = 0;
    syncStore();
  },
  generateAgentId(): string {
    return `agent-${Date.now()}-${++_idCounter}`;
  },
};
