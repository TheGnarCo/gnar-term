/**
 * Shared utilities for agent display — used by dashboards, sidebar, etc.
 *
 * All functions here are pure (no side effects, no DOM, no stores).
 * They operate on the domain types from types.ts and theme data from theme-data.ts.
 */

import type { AgentStatus, Workspace, HarnessSurface } from "./types";
import { getAllSurfaces, isHarnessSurface, isTerminalSurface } from "./types";
import type { ThemeDef } from "./theme-data";

/** Map an agent status to a theme-appropriate color string. */
export function agentStatusColor(status: AgentStatus, theme: ThemeDef): string {
  switch (status) {
    case "running":
      return theme.accent;
    case "waiting":
      return theme.warning;
    case "error":
      return theme.danger;
    case "idle":
      return theme.fgDim;
    case "exited":
      return theme.success;
  }
}

/** Human-readable label for an agent status. */
export function agentStatusLabel(status: AgentStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
    case "exited":
      return "Exited";
  }
}

/** Flattened info about a single agent (harness or terminal-with-agent) for display. */
export interface AgentInfo {
  surfaceId: string;
  presetId: string;
  title: string;
  status: AgentStatus;
  workspaceId: string;
  workspaceName: string;
  projectId?: string;
  branch?: string;
}

/** Extract all agents from a single workspace. */
export function getAgentsFromWorkspace(ws: Workspace): AgentInfo[] {
  const agents: AgentInfo[] = [];
  for (const s of getAllSurfaces(ws)) {
    if (isHarnessSurface(s)) {
      agents.push({
        surfaceId: s.id,
        presetId: s.presetId,
        title: s.title,
        status: s.status,
        workspaceId: ws.id,
        workspaceName: ws.name,
        projectId: ws.record?.projectId,
        branch: ws.record?.branch,
      });
    } else if (isTerminalSurface(s) && s.agentStatus) {
      agents.push({
        surfaceId: s.id,
        presetId: "terminal-agent",
        title: s.title,
        status: s.agentStatus,
        workspaceId: ws.id,
        workspaceName: ws.name,
        projectId: ws.record?.projectId,
        branch: ws.record?.branch,
      });
    }
  }
  return agents;
}

/** Extract all agents from multiple workspaces. */
export function getAgentsFromWorkspaces(workspaces: Workspace[]): AgentInfo[] {
  return workspaces.flatMap(getAgentsFromWorkspace);
}

/**
 * Find the first waiting agent across all workspaces.
 * Scans workspaces in order, surfaces in order within each workspace.
 * Returns the workspaceId and surfaceId of the first waiting agent, or null if none.
 */
export function findNextWaitingAgent(
  workspaces: Workspace[],
): { workspaceId: string; surfaceId: string } | null {
  for (const ws of workspaces) {
    for (const s of getAllSurfaces(ws)) {
      if (isHarnessSurface(s) && s.status === "waiting") {
        return { workspaceId: ws.id, surfaceId: s.id };
      }
      if (isTerminalSurface(s) && s.agentStatus === "waiting") {
        return { workspaceId: ws.id, surfaceId: s.id };
      }
    }
  }
  return null;
}

/**
 * Resolve the display name for a harness preset.
 * Looks up presetId in the provided harness presets list, falling back to "Agent".
 */
export function resolvePresetName(
  presetId: string,
  harnesses: Array<{ id: string; name: string }>,
): string {
  return harnesses.find((h) => h.id === presetId)?.name || "Agent";
}
