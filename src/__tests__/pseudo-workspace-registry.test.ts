/**
 * Tests for the pseudo-workspace registry. Covers register / unregister
 * / position-bucketing — the surface sidebar rendering code (Stage 6+)
 * and the agentic extension (Stage 7) will consume.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  getPseudoWorkspace,
  getPseudoWorkspaces,
  getRootBottomPseudoWorkspaces,
  getRootTopPseudoWorkspaces,
  pseudoWorkspaceStore,
  registerPseudoWorkspace,
  resetPseudoWorkspaces,
  unregisterPseudoWorkspace,
  unregisterPseudoWorkspacesBySource,
  type PseudoWorkspace,
} from "../lib/services/pseudo-workspace-registry";

function makePW(overrides: Partial<PseudoWorkspace> = {}): PseudoWorkspace {
  const IconStub = {} as unknown;
  const RenderStub = {} as unknown;
  return {
    id: "ext-a.example",
    source: "ext-a",
    label: "Example",
    position: "root-top",
    icon: IconStub,
    render: RenderStub,
    metadata: {},
    ...overrides,
  };
}

describe("pseudo-workspace registry", () => {
  beforeEach(() => {
    resetPseudoWorkspaces();
  });

  afterEach(() => {
    resetPseudoWorkspaces();
  });

  it("register adds a pseudo-workspace and exposes it via the store", () => {
    const pw = makePW();
    registerPseudoWorkspace(pw);
    expect(get(pseudoWorkspaceStore)).toEqual([pw]);
    expect(getPseudoWorkspace("ext-a.example")).toBe(pw);
  });

  it("re-registering the same id replaces the existing entry", () => {
    registerPseudoWorkspace(makePW({ label: "Old" }));
    registerPseudoWorkspace(makePW({ label: "New" }));
    expect(getPseudoWorkspaces()).toHaveLength(1);
    expect(getPseudoWorkspaces()[0]?.label).toBe("New");
  });

  it("unregister by id removes a single pseudo-workspace", () => {
    registerPseudoWorkspace(makePW({ id: "pw.a" }));
    registerPseudoWorkspace(makePW({ id: "pw.b" }));
    unregisterPseudoWorkspace("pw.a");
    expect(getPseudoWorkspaces().map((p) => p.id)).toEqual(["pw.b"]);
  });

  it("unregisterBySource removes every pseudo-workspace registered by an extension", () => {
    registerPseudoWorkspace(makePW({ id: "a", source: "ext-1" }));
    registerPseudoWorkspace(makePW({ id: "b", source: "ext-1" }));
    registerPseudoWorkspace(makePW({ id: "c", source: "ext-2" }));
    unregisterPseudoWorkspacesBySource("ext-1");
    expect(getPseudoWorkspaces().map((p) => p.id)).toEqual(["c"]);
  });

  describe("position buckets", () => {
    it("root-top helper returns only top-pinned entries, in registration order", () => {
      const top1 = makePW({ id: "top-1", position: "root-top" });
      const bottom = makePW({ id: "bot-1", position: "root-bottom" });
      const top2 = makePW({ id: "top-2", position: "root-top" });
      registerPseudoWorkspace(top1);
      registerPseudoWorkspace(bottom);
      registerPseudoWorkspace(top2);
      expect(getRootTopPseudoWorkspaces().map((p) => p.id)).toEqual([
        "top-1",
        "top-2",
      ]);
    });

    it("root-bottom helper returns only bottom-pinned entries", () => {
      registerPseudoWorkspace(makePW({ id: "t", position: "root-top" }));
      const bottom = makePW({ id: "b", position: "root-bottom" });
      registerPseudoWorkspace(bottom);
      expect(getRootBottomPseudoWorkspaces()).toEqual([bottom]);
    });

    it("both buckets are empty when no pseudo-workspaces are registered", () => {
      expect(getRootTopPseudoWorkspaces()).toEqual([]);
      expect(getRootBottomPseudoWorkspaces()).toEqual([]);
    });
  });

  it("carries synthetic metadata through unchanged — consumers will read it via DashboardHostContext", () => {
    const pw = makePW({
      id: "agentic.global",
      metadata: { isGlobalAgenticDashboard: true, custom: 42 },
    });
    registerPseudoWorkspace(pw);
    expect(getPseudoWorkspace("agentic.global")?.metadata).toEqual({
      isGlobalAgenticDashboard: true,
      custom: 42,
    });
  });
});
