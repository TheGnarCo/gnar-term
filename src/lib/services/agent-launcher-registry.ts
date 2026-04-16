/**
 * Agent Launcher Registry — store-based agent launch command registration.
 *
 * The agentic-orchestrator extension registers known agent patterns here.
 * NewSurfaceButton reads from this store to populate the dropdown with
 * agent launch options (terminals with preset startup commands).
 */
import { createRegistry } from "./create-registry";

export interface AgentLauncher {
  id: string;
  label: string;
  command: string;
  source: string;
}

const registry = createRegistry<AgentLauncher>();

export const agentLauncherStore = registry.store;
export const registerAgentLauncher = registry.register;
export const unregisterAgentLaunchersBySource = registry.unregisterBySource;
export const resetAgentLaunchers = registry.reset;
