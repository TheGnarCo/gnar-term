/**
 * agent-detection-service — barrel re-export.
 *
 * Passive detection of AI coding agents running inside gnar-term
 * terminals. Always-on, core-owned: every terminal surface across every
 * workspace is observed from app startup, and every consumer (the
 * agentic extension, status chrome, attention API) reads the same agent
 * registry.
 *
 * The implementation is split across five slices in the
 * `agent-detection-*` family — see each file's leading comment:
 *
 *   - `agent-detection-registry`    — canonical DetectedAgent list +
 *                                     agentsStore (the reactive read
 *                                     surface). Owns mutation via the
 *                                     internal `_registry` accessor.
 *   - `agent-detection-state-store` — per-pane reactive stores
 *                                     (paneAgentTypeStore +
 *                                     paneAgentStateStore) and the
 *                                     typed AgentState machine driver.
 *   - `agent-detection-patterns`    — pure pattern matching, default
 *                                     pattern list, and the surface →
 *                                     workspace/pty/argv lookups.
 *   - `agent-detection-publish`     — StatusTracker state machine plus
 *                                     attach/detach/publish lifecycle:
 *                                     mutates the registry, pane store,
 *                                     status registry, event bus, and
 *                                     surface-service unread flag.
 *   - `agent-detection-controller`  — initAgentDetection /
 *                                     destroyAgentDetection / event
 *                                     wiring. The only slice that owns
 *                                     subscriptions.
 *
 * Public surface re-exported below is the only thing extensions /
 * components / tests should import. New core code should usually go
 * straight to the appropriate slice — the barrel exists to keep
 * historical imports stable.
 */
export {
  agentsStore,
  getAgents,
  getAgentByAgentId,
  getAgentBySurfaceId,
  setAgentsForTests,
  type DetectedAgent,
} from "./agent-detection-registry";

export {
  paneAgentTypeStore,
  paneAgentStateStore,
  dispatchPaneAgentStateEvent,
  type PaneAgentEntry,
  type PaneAgentStateEntry,
} from "./agent-detection-state-store";

export {
  initAgentDetection,
  destroyAgentDetection,
  resetAgentDetectionForTests,
} from "./agent-detection-controller";
