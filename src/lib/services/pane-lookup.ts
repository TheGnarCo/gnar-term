/**
 * pane-lookup — shared read-only helpers for resolving a paneId against
 * the workspaces store. Both the MCP `get_pane_agent` / `emit_attention`
 * handlers and the agentic extension's spawn affordances need to ask
 * "does this pane still exist?" and "what AgentType did the user
 * intend to host here?" without each rolling its own scan.
 */
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { getAllPanes } from "../types";
import type { AgentType } from "./agent-type";

/** Return true if a pane with `paneId` is present in the workspaces store. */
export function paneExists(paneId: string): boolean {
  for (const ws of get(workspaces)) {
    for (const pane of getAllPanes(ws.paneLayout)) {
      if (pane.id === paneId) return true;
    }
  }
  return false;
}

/** Read a pane's `intendedAgent` hint, or null when the pane is missing. */
export function lookupPaneIntendedAgent(paneId: string): AgentType | null {
  for (const ws of get(workspaces)) {
    for (const pane of getAllPanes(ws.paneLayout)) {
      if (pane.id === paneId) {
        return pane.intendedAgent ?? null;
      }
    }
  }
  return null;
}
