/**
 * Diff Viewer Commands + Context Menu — Story 3b
 *
 * Tests that the diff-viewer manifest declares new commands and
 * context menu items for staged diffs, file diffs, and right-click
 * context menu integration.
 */
import { describe, it, expect } from "vitest";
import { diffViewerManifest } from "../index";

describe("Diff Viewer Commands", () => {
  const commands = diffViewerManifest.contributes?.commands;

  it("declares the show-staged command", () => {
    const cmd = commands!.find((c) => c.id === "show-staged");
    expect(cmd).toBeDefined();
    expect(cmd!.title).toBe("Show Staged Changes");
  });

  it("declares the diff-file command", () => {
    const cmd = commands!.find((c) => c.id === "diff-file");
    expect(cmd).toBeDefined();
    expect(cmd!.title).toBe("Diff File...");
  });

  it("still declares the original commands", () => {
    expect(commands!.find((c) => c.id === "show-uncommitted")).toBeDefined();
    expect(commands!.find((c) => c.id === "compare-branches")).toBeDefined();
  });
});

describe("Diff Viewer Context Menu", () => {
  const contextMenuItems = diffViewerManifest.contributes?.contextMenuItems;

  it("declares context menu items", () => {
    expect(contextMenuItems).toBeDefined();
    expect(contextMenuItems!.length).toBeGreaterThanOrEqual(1);
  });

  it("declares a diff-file context menu item for all files", () => {
    const item = contextMenuItems!.find((c) => c.id === "diff-file");
    expect(item).toBeDefined();
    expect(item!.label).toBe("Show Diff");
    expect(item!.when).toBe("*");
  });
});
