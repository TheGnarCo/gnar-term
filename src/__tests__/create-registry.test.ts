/**
 * Tests for createRegistry — the generic registry factory used by
 * command, sidebar-tab, sidebar-section, and surface-type registries.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { createRegistry } from "../lib/services/create-registry";

interface TestItem {
  id: string;
  label: string;
  source: string;
}

describe("createRegistry", () => {
  let registry: ReturnType<typeof createRegistry<TestItem>>;

  beforeEach(() => {
    registry = createRegistry<TestItem>();
  });

  it("starts empty", () => {
    expect(get(registry.store)).toEqual([]);
  });

  it("registers an item", () => {
    registry.register({ id: "a", label: "A", source: "ext-1" });
    expect(get(registry.store)).toEqual([
      { id: "a", label: "A", source: "ext-1" },
    ]);
  });

  it("replaces an item with the same id", () => {
    registry.register({ id: "a", label: "A", source: "ext-1" });
    registry.register({ id: "a", label: "A-updated", source: "ext-1" });
    const items = get(registry.store);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("A-updated");
  });

  it("appends items with different ids", () => {
    registry.register({ id: "a", label: "A", source: "ext-1" });
    registry.register({ id: "b", label: "B", source: "ext-2" });
    expect(get(registry.store)).toHaveLength(2);
  });

  it("unregisters by id", () => {
    registry.register({ id: "a", label: "A", source: "ext-1" });
    registry.register({ id: "b", label: "B", source: "ext-1" });
    registry.unregister("a");
    const items = get(registry.store);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b");
  });

  it("unregisters by source", () => {
    registry.register({ id: "a", label: "A", source: "ext-1" });
    registry.register({ id: "b", label: "B", source: "ext-2" });
    registry.register({ id: "c", label: "C", source: "ext-1" });
    registry.unregisterBySource("ext-1");
    const items = get(registry.store);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b");
  });

  it("resets to empty", () => {
    registry.register({ id: "a", label: "A", source: "ext-1" });
    registry.register({ id: "b", label: "B", source: "ext-2" });
    registry.reset();
    expect(get(registry.store)).toEqual([]);
  });

  it("unregister is a no-op for unknown id", () => {
    registry.register({ id: "a", label: "A", source: "ext-1" });
    registry.unregister("unknown");
    expect(get(registry.store)).toHaveLength(1);
  });

  it("unregisterBySource is a no-op for unknown source", () => {
    registry.register({ id: "a", label: "A", source: "ext-1" });
    registry.unregisterBySource("unknown");
    expect(get(registry.store)).toHaveLength(1);
  });

  it("get retrieves item by id", () => {
    registry.register({ id: "a", label: "A", source: "ext-1" });
    expect(registry.get("a")).toEqual({ id: "a", label: "A", source: "ext-1" });
    expect(registry.get("unknown")).toBeUndefined();
  });

  describe("reorder", () => {
    beforeEach(() => {
      registry.register({ id: "a", label: "A", source: "ext-1" });
      registry.register({ id: "b", label: "B", source: "ext-1" });
      registry.register({ id: "c", label: "C", source: "ext-1" });
      registry.register({ id: "d", label: "D", source: "ext-1" });
    });

    it("moves an item backward (higher index to lower)", () => {
      // Move item at index 2 ("c") to index 0
      registry.reorder(2, 0);
      const ids = get(registry.store).map((i) => i.id);
      expect(ids).toEqual(["c", "a", "b", "d"]);
    });

    it("moves an item forward (lower index to higher)", () => {
      // Move item at index 0 ("a") to index 2
      // The splice-then-insert adjusts: insertAt = 2-1 = 1
      registry.reorder(0, 2);
      const ids = get(registry.store).map((i) => i.id);
      expect(ids).toEqual(["b", "a", "c", "d"]);
    });

    it("is a no-op when from and to are the same", () => {
      registry.reorder(1, 1);
      const ids = get(registry.store).map((i) => i.id);
      expect(ids).toEqual(["a", "b", "c", "d"]);
    });

    it("moves an item to the end", () => {
      // Move "a" (index 0) to after "d" (index 3)
      registry.reorder(0, 4);
      const ids = get(registry.store).map((i) => i.id);
      expect(ids).toEqual(["b", "c", "d", "a"]);
    });

    it("moves the last item to the beginning", () => {
      registry.reorder(3, 0);
      const ids = get(registry.store).map((i) => i.id);
      expect(ids).toEqual(["d", "a", "b", "c"]);
    });

    it("handles adjacent swap forward", () => {
      registry.reorder(1, 2);
      const ids = get(registry.store).map((i) => i.id);
      // fromIdx=1 ("b"), toIdx=2 > fromIdx=1, so insertAt=1 → stays in place
      expect(ids).toEqual(["a", "b", "c", "d"]);
    });

    it("handles adjacent swap backward", () => {
      registry.reorder(2, 1);
      const ids = get(registry.store).map((i) => i.id);
      expect(ids).toEqual(["a", "c", "b", "d"]);
    });
  });
});
