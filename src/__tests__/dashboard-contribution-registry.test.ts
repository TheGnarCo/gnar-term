/**
 * Tests for the dashboard-contribution registry. Covers register /
 * unregister / cap enforcement / availability gating — the surface
 * `getDashboardContributionsForGroup` and `canAddContributionToGroup`
 * expose to Stage 5+ consumers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { WorkspaceEntry } from "../lib/config";
import {
  canAddContributionToGroup,
  dashboardContributionStore,
  getDashboardContribution,
  getDashboardContributions,
  getDashboardContributionsForGroup,
  registerDashboardContribution,
  resetDashboardContributions,
  unregisterDashboardContribution,
  unregisterDashboardContributionsBySource,
  type DashboardContribution,
} from "../lib/services/dashboard-contribution-registry";

function makeGroup(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "g1",
    name: "Test Group",
    path: "/tmp/g1",
    color: "blue",
    workspaceIds: [],
    isGit: false,
    createdAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function makeContribution(
  overrides: Partial<DashboardContribution> = {},
): DashboardContribution {
  return {
    id: "example",
    source: "test-ext",
    label: "Example Dashboard",
    actionLabel: "Add Example Dashboard",
    capPerGroup: 1,
    create: vi.fn(async () => "ws-new"),
    ...overrides,
  };
}

describe("dashboard-contribution registry", () => {
  beforeEach(() => {
    resetDashboardContributions();
  });

  afterEach(() => {
    resetDashboardContributions();
  });

  it("register adds a contribution and exposes it via the store", () => {
    const c = makeContribution();
    registerDashboardContribution(c);
    expect(get(dashboardContributionStore)).toEqual([c]);
    expect(getDashboardContribution("example")).toBe(c);
  });

  it("preserves registration order across multiple contributions", () => {
    const a = makeContribution({ id: "a", source: "ext-a" });
    const b = makeContribution({ id: "b", source: "ext-b" });
    const c = makeContribution({ id: "c", source: "ext-c" });
    registerDashboardContribution(a);
    registerDashboardContribution(b);
    registerDashboardContribution(c);
    expect(getDashboardContributions().map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("unregister by id removes a single contribution", () => {
    registerDashboardContribution(makeContribution({ id: "a" }));
    registerDashboardContribution(makeContribution({ id: "b" }));
    unregisterDashboardContribution("a");
    expect(getDashboardContributions().map((c) => c.id)).toEqual(["b"]);
  });

  it("unregisterBySource removes every contribution registered by one extension", () => {
    registerDashboardContribution(
      makeContribution({ id: "a", source: "ext-1" }),
    );
    registerDashboardContribution(
      makeContribution({ id: "b", source: "ext-1" }),
    );
    registerDashboardContribution(
      makeContribution({ id: "c", source: "ext-2" }),
    );
    unregisterDashboardContributionsBySource("ext-1");
    expect(getDashboardContributions().map((c) => c.id)).toEqual(["c"]);
  });

  describe("getDashboardContributionsForGroup", () => {
    it("returns every contribution when none have availability gates", () => {
      const a = makeContribution({ id: "a" });
      const b = makeContribution({ id: "b" });
      registerDashboardContribution(a);
      registerDashboardContribution(b);
      expect(getDashboardContributionsForGroup(makeGroup())).toEqual([a, b]);
    });

    it("filters out contributions whose isAvailableFor returns false", () => {
      const always = makeContribution({
        id: "always",
        isAvailableFor: () => true,
      });
      const never = makeContribution({
        id: "never",
        isAvailableFor: () => false,
      });
      registerDashboardContribution(always);
      registerDashboardContribution(never);
      const group = makeGroup();
      expect(getDashboardContributionsForGroup(group).map((c) => c.id)).toEqual(
        ["always"],
      );
    });

    it("passes the group to each gate so contributions can branch on it", () => {
      const gate = vi.fn((g: WorkspaceEntry) => g.isGit);
      registerDashboardContribution(
        makeContribution({ id: "gitOnly", isAvailableFor: gate }),
      );
      const gitGroup = makeGroup({ id: "g-git", isGit: true });
      const plainGroup = makeGroup({ id: "g-plain", isGit: false });
      expect(
        getDashboardContributionsForGroup(gitGroup).map((c) => c.id),
      ).toEqual(["gitOnly"]);
      expect(
        getDashboardContributionsForGroup(plainGroup).map((c) => c.id),
      ).toEqual([]);
      expect(gate).toHaveBeenCalledWith(gitGroup);
      expect(gate).toHaveBeenCalledWith(plainGroup);
    });
  });

  describe("canAddContributionToGroup (cap enforcement)", () => {
    it("returns false when the contribution is not registered", () => {
      expect(canAddContributionToGroup(makeGroup(), "unregistered", 0)).toBe(
        false,
      );
    });

    it("allows adding while under the cap", () => {
      registerDashboardContribution(makeContribution({ capPerGroup: 1 }));
      expect(canAddContributionToGroup(makeGroup(), "example", 0)).toBe(true);
    });

    it("rejects adding when the count equals the cap", () => {
      registerDashboardContribution(makeContribution({ capPerGroup: 1 }));
      expect(canAddContributionToGroup(makeGroup(), "example", 1)).toBe(false);
    });

    it("rejects adding when the count exceeds the cap", () => {
      registerDashboardContribution(makeContribution({ capPerGroup: 2 }));
      expect(canAddContributionToGroup(makeGroup(), "example", 3)).toBe(false);
    });

    it("rejects adding when isAvailableFor denies the group, even under cap", () => {
      registerDashboardContribution(
        makeContribution({
          capPerGroup: 1,
          isAvailableFor: () => false,
        }),
      );
      expect(canAddContributionToGroup(makeGroup(), "example", 0)).toBe(false);
    });

    it("honors Number.POSITIVE_INFINITY as effectively unlimited", () => {
      registerDashboardContribution(
        makeContribution({ capPerGroup: Number.POSITIVE_INFINITY }),
      );
      expect(canAddContributionToGroup(makeGroup(), "example", 10_000)).toBe(
        true,
      );
    });
  });
});
