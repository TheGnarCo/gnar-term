/**
 * Tests for the diff-viewer included extension — validates that the extension
 * registers a surface type and commands via the extension API.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { diffViewerManifest, registerDiffViewerExtension } from "../index";
import {
  commandStore,
  resetCommands,
} from "../../../lib/services/command-registry";
import {
  surfaceTypeStore,
  resetSurfaceTypes,
} from "../../../lib/services/surface-type-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";

describe("Diff Viewer included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetCommands();
    resetSurfaceTypes();
  });

  // --- Manifest tests ---

  it("manifest has correct id, name, and version", () => {
    expect(diffViewerManifest.id).toBe("diff-viewer");
    expect(diffViewerManifest.name).toBe("Diff Viewer");
    expect(diffViewerManifest.version).toBe("0.1.0");
    expect(diffViewerManifest.included).toBe(true);
  });

  it("manifest declares a diff surface", () => {
    const surfaces = diffViewerManifest.contributes?.surfaces;
    expect(surfaces).toHaveLength(1);
    expect(surfaces![0]).toEqual({ id: "diff", label: "Diff" });
  });

  it("manifest declares commands", () => {
    const commands = diffViewerManifest.contributes?.commands;
    expect(commands).toHaveLength(4);
    expect(commands).toEqual([
      { id: "show-uncommitted", title: "Show Uncommitted Changes" },
      { id: "show-staged", title: "Show Staged Changes" },
      { id: "diff-file", title: "Diff File..." },
      { id: "compare-branches", title: "Compare Branches..." },
    ]);
  });

  it("manifest declares settings (diffMode, contextLines, ignoreWhitespace)", () => {
    const settings = diffViewerManifest.contributes?.settings;
    expect(settings).toBeDefined();
    const fields = settings!.fields;
    expect(fields.diffMode).toBeDefined();
    expect(fields.diffMode.type).toBe("select");
    expect(fields.diffMode.default).toBe("unified");
    expect(fields.contextLines).toBeDefined();
    expect(fields.contextLines.type).toBe("number");
    expect(fields.contextLines.default).toBe(3);
    expect(fields.ignoreWhitespace).toBeDefined();
    expect(fields.ignoreWhitespace.type).toBe("boolean");
    expect(fields.ignoreWhitespace.default).toBe(false);
  });

  // --- Registration tests ---

  it("registers the surface type on activation", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const types = get(surfaceTypeStore);
    const diffType = types.find((t) => t.id === "diff-viewer:diff");
    expect(diffType).toBeTruthy();
    expect(diffType!.source).toBe("diff-viewer");
  });

  it("registers both commands on activation", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const cmds = get(commandStore);
    const showUncommitted = cmds.find(
      (c) => c.id === "diff-viewer:show-uncommitted",
    );
    const compareBranches = cmds.find(
      (c) => c.id === "diff-viewer:compare-branches",
    );

    expect(showUncommitted).toBeTruthy();
    expect(showUncommitted!.title).toBe("Show Uncommitted Changes");
    expect(showUncommitted!.source).toBe("diff-viewer");

    expect(compareBranches).toBeTruthy();
    expect(compareBranches!.title).toBe("Compare Branches...");
    expect(compareBranches!.source).toBe("diff-viewer");
  });
});
