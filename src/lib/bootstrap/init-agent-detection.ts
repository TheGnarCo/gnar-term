/**
 * Agent detection bootstrap — starts the always-on passive detection
 * service. Detection is a core noun: workspace indicators, per-surface
 * tab dots, and the agent registry all come from here, consumable by
 * any extension that wants to render agent UI.
 */
import { initAgentDetection } from "../services/agent-detection-service";

export function initAgentDetectionBootstrap(): void {
  initAgentDetection();
}
