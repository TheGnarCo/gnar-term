/**
 * Extension Permission System — Stories A + B
 *
 * Tests that the permission model correctly gates copy_files behind
 * "filesystem" and run_script behind "shell" (not just "pty").
 */
import { describe, it, expect } from "vitest";
import { agenticOrchestratorManifest } from "../extensions/agentic-orchestrator/index";

describe("Permission model", () => {
  describe("filesystem permission", () => {
    it("agentic-orchestrator declares filesystem permission (needs write_file + ensure_dir)", () => {
      const perms = agenticOrchestratorManifest.permissions || [];
      expect(perms).toContain("filesystem");
    });
  });

  describe("shell permission", () => {
    it("agentic-orchestrator does NOT declare shell permission", () => {
      const perms = agenticOrchestratorManifest.permissions || [];
      expect(perms).not.toContain("shell");
    });
  });

  describe("observe permission", () => {
    it("agentic-orchestrator no longer needs observe — detection is core-owned", () => {
      // Passive agent detection moved into core (agent-detection-service).
      // The extension is now pure UI + spawn glue, so the elevated
      // observe permission is no longer required.
      expect(agenticOrchestratorManifest.permissions).not.toContain("observe");
      expect(agenticOrchestratorManifest.permissions).not.toContain("pty");
    });
  });
});
