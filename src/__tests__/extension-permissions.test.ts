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
    it("agentic-orchestrator does NOT declare filesystem permission", () => {
      const perms = agenticOrchestratorManifest.permissions || [];
      expect(perms).not.toContain("filesystem");
    });
  });

  describe("shell permission", () => {
    it("agentic-orchestrator does NOT declare shell permission", () => {
      const perms = agenticOrchestratorManifest.permissions || [];
      expect(perms).not.toContain("shell");
    });
  });

  describe("observe permission", () => {
    it("agentic-orchestrator has observe permission (no longer pty)", () => {
      expect(agenticOrchestratorManifest.permissions).toContain("observe");
      expect(agenticOrchestratorManifest.permissions).not.toContain("pty");
    });
  });
});
