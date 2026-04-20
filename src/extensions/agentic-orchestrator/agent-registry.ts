/**
 * Agent Registry — centralized tracking of detected AI agents.
 *
 * Maintains a list of currently-detected agents in api.state so that
 * downstream features (sidebar tab, notifications, session log) can
 * query the full set of agents and their current status.
 *
 * The registry is initialized once during extension activation via
 * initRegistry(). Detection logic in index.ts calls register,
 * unregister, and updateStatus as agents are detected and exit.
 */
import { writable, type Readable } from "svelte/store";
import type { ExtensionAPI } from "../api";

export interface DetectedAgent {
  agentId: string;
  agentName: string;
  surfaceId: string;
  workspaceId: string;
  status: string;
  createdAt: string;
  lastStatusChange: string;
}

export interface SessionLogEntry extends DetectedAgent {
  closedAt: string;
}

const STATE_KEY = "detectedAgents";
const SESSION_LOG_KEY = "sessionLog";
const SESSION_LOG_MAX = 50;

let _api: ExtensionAPI | null = null;
let _idCounter = 0;

/**
 * Reactive mirror of the detected-agents list. Widgets (Kanban,
 * AgentList, AgentStatusRow, etc.) subscribe here for live updates —
 * api.state is a plain Map so reading it from a Svelte component does
 * not trigger reactivity on its own. Mutations in this file write to
 * both api.state (the source of truth, persisted across activations)
 * and this store (the reactive surface).
 */
const _agentsStore = writable<DetectedAgent[]>([]);
export const agentsStore: Readable<DetectedAgent[]> = _agentsStore;

function syncStore(): void {
  _agentsStore.set(getAgents().slice());
}

export function initRegistry(api: ExtensionAPI): void {
  _api = api;
  // Ensure clean state on activation (no ghost entries from prior session)
  _api.state.set(STATE_KEY, []);
  if (!_api.state.get(SESSION_LOG_KEY)) {
    _api.state.set(SESSION_LOG_KEY, []);
  }
  syncStore();
}

export function generateAgentId(): string {
  return `agent-${Date.now()}-${++_idCounter}`;
}

export function registerAgent(instance: DetectedAgent): void {
  if (!_api) return;
  const instances = getAgents();
  instances.push(instance);
  _api.state.set(STATE_KEY, instances);
  syncStore();
}

export function unregisterAgent(agentId: string): void {
  if (!_api) return;
  const instances = getAgents();
  const removed = instances.find((a) => a.agentId === agentId);
  _api.state.set(
    STATE_KEY,
    instances.filter((a) => a.agentId !== agentId),
  );
  syncStore();

  // Record in session log
  if (removed) {
    const log = getSessionLog();
    const entry: SessionLogEntry = {
      ...removed,
      closedAt: new Date().toISOString(),
    };
    log.unshift(entry);
    _api.state.set(SESSION_LOG_KEY, log.slice(0, SESSION_LOG_MAX));
  }
}

export function updateAgentStatus(agentId: string, status: string): void {
  if (!_api) return;
  const instances = getAgents();
  const instance = instances.find((a) => a.agentId === agentId);
  if (instance) {
    instance.status = status;
    instance.lastStatusChange = new Date().toISOString();
    _api.state.set(STATE_KEY, instances);
    syncStore();
  }
}

export function getAgents(): DetectedAgent[] {
  if (!_api) return [];
  return _api.state.get<DetectedAgent[]>(STATE_KEY) || [];
}

export function getSessionLog(): SessionLogEntry[] {
  if (!_api) return [];
  return _api.state.get<SessionLogEntry[]>(SESSION_LOG_KEY) || [];
}

/**
 * Reset internal state — for testing only.
 */
export function resetRegistry(): void {
  _api = null;
  _idCounter = 0;
  _agentsStore.set([]);
}
