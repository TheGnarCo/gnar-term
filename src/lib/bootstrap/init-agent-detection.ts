/**
 * Agent detection bootstrap — starts the always-on passive detection
 * service. Detection is a core noun: workspace indicators, per-surface
 * tab dots, and the agent registry all come from here, consumable by
 * any extension that wants to render agent UI.
 *
 * Call site is added by whichever branch removes the legacy
 * extension-side detection (the agentic-orchestrator commit on
 * jrvs/oc-orchestrator), so there is never a moment where both the
 * core service and the extension's duplicate pipeline run in parallel.
 */
import { initAgentDetection } from "../services/agent-detection-service";

export function initAgentDetectionBootstrap(): void {
  initAgentDetection();
}
