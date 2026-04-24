import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  reorderContext,
  anyReorderActive,
  innerReorderActive,
  blockReorderActive,
} from "../lib/stores/ui";

describe("reorder state stores", () => {
  beforeEach(() => {
    reorderContext.set(null);
  });

  it("all derived stores read false / null when nothing is being dragged", () => {
    expect(get(reorderContext)).toBeNull();
    expect(get(anyReorderActive)).toBe(false);
    expect(get(innerReorderActive)).toBe(false);
    expect(get(blockReorderActive)).toBe(false);
  });

  it("workspace-kind context makes any + inner active, but not block", () => {
    reorderContext.set({
      kind: "workspace",
      scopeId: "__workspaces__",
      containerBlockId: "__workspaces__",
    });
    expect(get(anyReorderActive)).toBe(true);
    expect(get(innerReorderActive)).toBe(true);
    expect(get(blockReorderActive)).toBe(false);
  });

  it("workspace-group-kind context makes any + inner active, but not block", () => {
    reorderContext.set({
      kind: "workspace-group",
      sourceGroupId: "group-1",
      containerBlockId: "__workspaces__",
    });
    expect(get(anyReorderActive)).toBe(true);
    expect(get(innerReorderActive)).toBe(true);
    expect(get(blockReorderActive)).toBe(false);
  });

  it("section-kind context makes any + block active, but not inner", () => {
    reorderContext.set({ kind: "section", sourceBlockId: "projects" });
    expect(get(anyReorderActive)).toBe(true);
    expect(get(innerReorderActive)).toBe(false);
    expect(get(blockReorderActive)).toBe(true);
  });

  it("workspace context preserves scopeId + containerBlockId for overlay logic", () => {
    reorderContext.set({
      kind: "workspace",
      scopeId: "project-abc",
      containerBlockId: "projects",
    });
    const ctx = get(reorderContext);
    expect(ctx).toEqual({
      kind: "workspace",
      scopeId: "project-abc",
      containerBlockId: "projects",
    });
  });
});
