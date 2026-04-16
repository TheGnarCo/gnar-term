/**
 * Extension Permission System — Stories A + B
 *
 * Tests that the permission model correctly gates copy_files behind
 * "filesystem" and run_script behind "shell" (not just "pty").
 */
import { describe, it, expect } from "vitest";
import { managedWorkspacesManifest } from "../extensions/managed-workspaces/index";
import { agenticOrchestratorManifest } from "../extensions/agentic-orchestrator/index";

describe("Permission model", () => {
  describe("filesystem permission", () => {
    it("managed-workspaces declares filesystem permission", () => {
      expect(managedWorkspacesManifest.permissions).toContain("filesystem");
    });

    it("agentic-orchestrator does NOT declare filesystem permission", () => {
      const perms = agenticOrchestratorManifest.permissions || [];
      expect(perms).not.toContain("filesystem");
    });
  });

  describe("shell permission", () => {
    it("managed-workspaces declares shell permission", () => {
      expect(managedWorkspacesManifest.permissions).toContain("shell");
    });

    it("agentic-orchestrator does NOT declare shell permission", () => {
      const perms = agenticOrchestratorManifest.permissions || [];
      expect(perms).not.toContain("shell");
    });
  });

  describe("pty permission unchanged", () => {
    it("managed-workspaces still has pty permission", () => {
      expect(managedWorkspacesManifest.permissions).toContain("pty");
    });

    it("agentic-orchestrator has observe permission (no longer pty)", () => {
      expect(agenticOrchestratorManifest.permissions).toContain("observe");
      expect(agenticOrchestratorManifest.permissions).not.toContain("pty");
    });
  });
});
