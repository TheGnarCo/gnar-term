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

  it("returns { kind: 'none' } when metadata has neither flag nor rootWorkspaceId", () => {
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

  it("detects a workspace-scoped host via a string rootWorkspaceId", () => {
    expect(deriveDashboardScope(host({ rootWorkspaceId: "g-42" }))).toEqual({
      kind: "workspace",
      rootWorkspaceId: "g-42",
    });
  });

  it("ignores an empty-string rootWorkspaceId — treats it as absent", () => {
    expect(deriveDashboardScope(host({ rootWorkspaceId: "" }))).toEqual({
      kind: "none",
    });
  });

  it("ignores a non-string rootWorkspaceId (e.g. a number leaked from a migration)", () => {
    expect(
      deriveDashboardScope(host({ rootWorkspaceId: 123 as unknown as string })),
    ).toEqual({ kind: "none" });
  });

  it("prioritizes the global flag over rootWorkspaceId when both are present (global is the stricter claim)", () => {
    // This is a defensive case — the two shouldn't coexist in practice,
    // but if a Workspace Dashboard ever embeds global-scoped widgets, the
    // global flag wins.
    expect(
      deriveDashboardScope(
        host({ isGlobalAgenticDashboard: true, rootWorkspaceId: "g-1" }),
      ),
    ).toEqual({ kind: "global" });
  });
});
