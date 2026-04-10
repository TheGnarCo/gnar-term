/**
 * Agentic Orchestrator — included extension
 *
 * Registers the "harness" surface type for running AI agent processes
 * with status tracking (running / waiting / idle).
 */
import type {
  ExtensionManifest,
  ExtensionAPI,
} from "../../lib/extension-types";
import HarnessSurface from "./HarnessSurface.svelte";

export const agenticOrchestratorManifest: ExtensionManifest = {
  id: "agentic-orchestrator",
  name: "Agentic Orchestrator",
  version: "0.1.0",
  description: "AI agent harness with status tracking",
  entry: "./index.ts",
  included: true,
  permissions: ["pty"],
  contributes: {
    surfaces: [{ id: "harness", label: "Harness" }],
    commands: [{ id: "spawn-harness", title: "Spawn Agent Harness..." }],
    settings: {
      fields: {
        idleTimeout: {
          type: "number",
          title: "Idle Timeout (seconds)",
          description: "Seconds of no output before marking harness as idle",
          default: 30,
        },
        defaultCommand: {
          type: "string",
          title: "Default Command",
          description: "Default command to run when spawning a harness",
          default: "",
        },
      },
    },
    events: [
      "surface:created",
      "surface:closed",
      "extension:harness:statusChanged",
    ],
  },
};

export function registerAgenticOrchestratorExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerSurfaceType("harness", HarnessSurface);

    api.registerCommand("spawn-harness", async () => {
      const defaultCmd = api.getSetting<string>("defaultCommand") || "";
      const command = await api.showInputPrompt("Command to run", defaultCmd);
      if (!command) return;

      const activeCwd = await api.getActiveCwd();
      const cwd = await api.showInputPrompt(
        "Working directory",
        activeCwd || "",
      );
      if (!cwd) return;

      const title = command.split(/\s+/)[0] || "Harness";
      api.openSurface("agentic-orchestrator:harness", title, {
        command,
        cwd,
      });
    });
  });
}
