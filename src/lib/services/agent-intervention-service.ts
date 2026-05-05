import { invoke } from "@tauri-apps/api/core";
import { getAgentByAgentId } from "./agent-detection-service";
import { lookupPtyIdForSurface } from "./service-helpers";
import { eventBus } from "./event-bus";

export async function interruptAgent(agentId: string): Promise<boolean> {
  const agent = getAgentByAgentId(agentId);
  if (!agent) return false;
  const ptyId = lookupPtyIdForSurface(agent.surfaceId);
  if (ptyId === undefined) return false;
  await invoke("write_pty", { ptyId, data: "\x03" });
  eventBus.emit({
    type: "agent:interrupted",
    agentId,
    agentName: agent.agentName,
  });
  return true;
}

export async function killAgent(agentId: string): Promise<boolean> {
  const agent = getAgentByAgentId(agentId);
  if (!agent) return false;
  const ptyId = lookupPtyIdForSurface(agent.surfaceId);
  if (ptyId === undefined) return false;
  await invoke("kill_pty", { ptyId });
  eventBus.emit({ type: "agent:killed", agentId, agentName: agent.agentName });
  return true;
}

export async function sendKeysToAgent(
  agentId: string,
  keys: string,
): Promise<boolean> {
  const agent = getAgentByAgentId(agentId);
  if (!agent) return false;
  const ptyId = lookupPtyIdForSurface(agent.surfaceId);
  if (ptyId === undefined) return false;
  await invoke("write_pty", { ptyId, data: keys });
  return true;
}
