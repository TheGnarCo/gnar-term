import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const WORKSPACE_ITEM = readFileSync(
  "src/lib/components/WorkspaceItem.svelte",
  "utf-8",
).replace(/\s+/g, " ");

const WORKSPACE_LIST_BLOCK = readFileSync(
  "src/lib/components/WorkspaceListBlock.svelte",
  "utf-8",
).replace(/\s+/g, " ");

const WORKSPACE_LIST_VIEW = readFileSync(
  "src/lib/components/WorkspaceListView.svelte",
  "utf-8",
).replace(/\s+/g, " ");

const GROUP_SECTION_CONTENT = readFileSync(
  "src/lib/components/WorkspaceGroupSectionContent.svelte",
  "utf-8",
).replace(/\s+/g, " ");

const EXTENSION_API = readFileSync(
  "src/lib/services/extension-api.ts",
  "utf-8",
).replace(/\s+/g, " ");

describe("grip visibility suppression", () => {
  it("WorkspaceItem keeps its own grip collapsed when any reorder is active unless the item is the drag source", () => {
    // WorkspaceItem still owns a grip when rendered INSIDE a project
    // (WorkspaceListView); at the root level it's rendered without
    // one (WorkspaceListBlock draws the grip externally). The visible
    // gate tracks row-level hover so hovering any part of the row
    // (not just the grip column) expands it.
    // shortcutHintsActive is intentionally excluded — meta-hold shows
    // the tooltip chip without triggering the solid-background drag state.
    expect(WORKSPACE_ITEM).toContain("anyReorderActive");
    expect(WORKSPACE_ITEM).toMatch(
      /visible=\{\s*dragActive\s*\|\|\s*\(\s*hovered\s*&&\s*!\s*\$anyReorderActive\s*\)\s*\}/,
    );
  });

  it("WorkspaceListBlock owns the root-row drag via createDragReorder", () => {
    // Rows no longer render an external grip — each renderer draws
    // its own grip (flush with the row) and forwards onMouseDown to
    // core's startRootRowDrag. Gate: createDragReorder is present.
    expect(WORKSPACE_LIST_BLOCK).toContain("createDragReorder");
    expect(WORKSPACE_LIST_BLOCK).toContain("anyReorderActive");
  });
});

describe("canStart gating", () => {
  it("WorkspaceListBlock's unified root drag gates canStart on anyReorderActive", () => {
    expect(WORKSPACE_LIST_BLOCK).toMatch(
      /canStart:\s*\(\)\s*=>\s*!\s*\$anyReorderActive/,
    );
  });

  it("WorkspaceListView has a canStart gate against anyReorderActive", () => {
    expect(WORKSPACE_LIST_VIEW).toMatch(
      /canStart:\s*\(\)\s*=>\s*!\s*\$anyReorderActive/,
    );
  });

  it("WorkspaceListBlock gates startRootRowDrag for locked workspace-groups", () => {
    expect(WORKSPACE_LIST_BLOCK).toContain(
      'srcRow?.kind === "workspace-group"',
    );
    expect(WORKSPACE_LIST_BLOCK).toContain("group?.locked === true");
  });
});

describe("reorderContext is published on every drag", () => {
  it("WorkspaceListBlock publishes a rootRow-kind context with __workspaces__ containerBlockId", () => {
    expect(WORKSPACE_LIST_BLOCK).toContain("reorderContext.set");
    expect(WORKSPACE_LIST_BLOCK).toMatch(/kind:\s*"rootRow"/);
    expect(WORKSPACE_LIST_BLOCK).toMatch(
      /containerBlockId:\s*"__workspaces__"/,
    );
  });

  it("WorkspaceListView accepts scopeId + containerBlockId props and publishes workspace-kind context", () => {
    expect(WORKSPACE_LIST_VIEW).toMatch(/export let scopeId/);
    expect(WORKSPACE_LIST_VIEW).toMatch(/export let containerBlockId/);
    expect(WORKSPACE_LIST_VIEW).toMatch(/kind:\s*"workspace"/);
  });

  it("WorkspaceGroupSectionContent threads scopeId={group.id} and containerBlockId to WorkspaceListView", () => {
    expect(GROUP_SECTION_CONTENT).toMatch(/scopeId=\{\s*group\.id\s*\}/);
    // containerBlockId is forwarded from the parent via the shorthand
    // attribute ({containerBlockId}) rather than hardcoded.
    expect(GROUP_SECTION_CONTENT).toMatch(/\{containerBlockId\}/);
  });
});

describe("extension API passes buildReorderContext through to the core store", () => {
  it("inner scope auto-gates canStart against anyReorderActive", () => {
    expect(EXTENSION_API).toContain("anyReorderActive");
  });

  it("inner scope invokes buildReorderContext and writes to reorderContext store", () => {
    expect(EXTENSION_API).toContain("buildReorderContext");
    expect(EXTENSION_API).toContain("reorderContext.set");
  });
});
