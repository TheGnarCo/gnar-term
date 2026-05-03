/**
 * Terminology cleanup test: ensures user-facing copy uses "Branch"
 * for the nested workspace level, not "NestedWorkspace".
 *
 * These tests grep source files for OLD strings that should no longer
 * appear in user-facing locations (red before the changes, green after).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const srcRoot = resolve(__dirname, "../../src/lib");

function readSrc(relPath: string): string {
  return readFileSync(resolve(srcRoot, relPath), "utf8");
}

describe("S8 terminology: NestedWorkspace → Branch in user-facing copy", () => {
  describe("init-workspaces.ts command palette titles", () => {
    const src = readSrc("bootstrap/init-workspaces.ts");

    it('command title does not say "New NestedWorkspace"', () => {
      expect(src).not.toContain("New NestedWorkspace");
    });

    it('command title does not say "Promote NestedWorkspace to Workspace"', () => {
      expect(src).not.toContain("Promote NestedWorkspace to Workspace");
    });

    it('generated nested workspace name uses "Branch" not "Workspace"', () => {
      // The generated name patterns look like `${x} Workspace ${n+1}`.
      // After the change they should all use "Branch".
      // We check for the specific old pattern.
      expect(src).not.toMatch(/`\$\{[^}]+\} Workspace \$\{/);
    });
  });

  describe("workspace-context-menu.ts nested workspace context menu labels", () => {
    const src = readSrc("utils/workspace-context-menu.ts");

    it('says "Rename Branched Workspace"', () => {
      expect(src).toContain('"Rename Branched Workspace"');
    });

    it('says "Lock Branched Workspace"', () => {
      expect(src).toContain('"Lock Branched Workspace"');
    });

    it('says "Unlock Branched Workspace"', () => {
      expect(src).toContain('"Unlock Branched Workspace"');
    });

    it('says "Close Branched Workspace"', () => {
      expect(src).toContain('"Close Branched Workspace"');
    });

    it('does not say bare "Rename Branch"', () => {
      expect(src).not.toContain('"Rename Branch"');
    });

    it('does not say bare "Close Branch"', () => {
      expect(src).not.toContain('"Close Branch"');
    });
  });

  describe("WorkspaceSectionContent.svelte confirmation dialog", () => {
    const src = readSrc("components/WorkspaceSectionContent.svelte");

    it('confirmation message does not say "nested workspace" in user-facing string literals', () => {
      // Comments in this file may use "nested workspace" — we only care about
      // the user-facing template literal in the confirm prompt.
      // The old text was: `nested workspace${...} will also be closed`
      expect(src).not.toMatch(/nested workspace.{0,5} will also be closed/);
    });
  });

  describe("EmptySurface.svelte user-visible text", () => {
    const src = readSrc("components/EmptySurface.svelte");

    it('says "No workspaces are open" (Workspace terminology)', () => {
      expect(src).toContain("No workspaces are open");
    });

    it('says "Jump to Workspace" section label (Workspace terminology)', () => {
      expect(src).toContain("Jump to Workspace");
    });

    it('does not say "No branches are open"', () => {
      expect(src).not.toContain("No branches are open");
    });

    it('does not say "Jump to branch"', () => {
      expect(src).not.toContain("Jump to branch");
    });
  });

  describe("ArchiveZone.svelte unarchive prompt", () => {
    const src = readSrc("components/ArchiveZone.svelte");

    it('does not say "nested workspaces" in confirm prompt (should be "branches")', () => {
      // The old string: "restore its nested workspaces"
      expect(src).not.toContain("nested workspaces");
    });
  });

  describe("terminal-service.ts default workspace recovery name", () => {
    const src = readSrc("terminal-service.ts");

    it('default recovery name is "Branch 1" not "Workspace 1"', () => {
      // The old literal in createDefaultWorkspace
      expect(src).not.toContain('"Workspace 1"');
    });
  });
});
