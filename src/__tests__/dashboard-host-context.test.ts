/**
 * Tests for the pure scope-derivation logic behind
 * `DashboardHostContext`. The set/getContext plumbing is thin Svelte
 * stdlib — the behavior worth asserting is `deriveDashboardScope`, the
 * single source of truth widgets will use to decide what to render.
 */
import { describe, expect, it } from "vitest";
import {
  deriveDashboardScope,
  type DashboardHostContext,
} from "../lib/contexts/dashboard-host";

function host(metadata: Record<string, unknown>): DashboardHostContext {
  return { metadata };
}

describe("deriveDashboardScope", () => {
  it("returns { kind: 'none' } when the host is null (no provider mounted)", () => {
    expect(deriveDashboardScope(null)).toEqual({ kind: "none" });
  });

  it("returns { kind: 'none' } when metadata has neither flag nor groupId", () => {
    expect(deriveDashboardScope(host({}))).toEqual({ kind: "none" });
    expect(deriveDashboardScope(host({ unrelated: 1 }))).toEqual({
      kind: "none",
    });
  });

  it("detects the Global Agentic Dashboard via the isGlobalAgenticDashboard flag", () => {
    expect(
      deriveDashboardScope(host({ isGlobalAgenticDashboard: true })),
    ).toEqual({
      kind: "global",
    });
  });

  it("requires the flag to be literally true (not just truthy) — guards against accidental string values", () => {
    expect(
      deriveDashboardScope(host({ isGlobalAgenticDashboard: "true" })),
    ).toEqual({
      kind: "none",
    });
    expect(deriveDashboardScope(host({ isGlobalAgenticDashboard: 1 }))).toEqual(
      {
        kind: "none",
      },
    );
  });

  it("detects a group host via a string groupId", () => {
    expect(deriveDashboardScope(host({ groupId: "g-42" }))).toEqual({
      kind: "group",
      groupId: "g-42",
    });
  });

  it("ignores an empty-string groupId — treats it as absent", () => {
    expect(deriveDashboardScope(host({ groupId: "" }))).toEqual({
      kind: "none",
    });
  });

  it("ignores a non-string groupId (e.g. a number leaked from a migration)", () => {
    expect(
      deriveDashboardScope(host({ groupId: 123 as unknown as string })),
    ).toEqual({ kind: "none" });
  });

  it("prioritizes the global flag over groupId when both are present (global is the stricter claim)", () => {
    // This is a defensive case — the two shouldn't coexist in practice,
    // but if a Group Dashboard ever embeds global-scoped widgets, the
    // global flag wins.
    expect(
      deriveDashboardScope(
        host({ isGlobalAgenticDashboard: true, groupId: "g-1" }),
      ),
    ).toEqual({ kind: "global" });
  });
});
