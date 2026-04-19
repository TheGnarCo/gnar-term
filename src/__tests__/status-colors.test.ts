/**
 * Status Colors — utility tests for variant-to-color mapping,
 * agent badge aggregation, and pane dot color resolution.
 */
import { describe, it, expect } from "vitest";
import {
  variantColor,
  aggregateAgentBadges,
  agentDotColorForPane,
} from "../lib/status-colors";
import type { StatusItem } from "../lib/types/status";

function makeStatusItem(
  overrides: Partial<StatusItem> & { id: string },
): StatusItem {
  return {
    source: "test",
    workspaceId: "ws-1",
    category: "process",
    priority: 100,
    label: "test",
    ...overrides,
  };
}

describe("variantColor", () => {
  it("returns green for success", () => {
    expect(variantColor("success")).toBe("#4ec957");
  });

  it("returns yellow for warning", () => {
    expect(variantColor("warning")).toBe("#e8b73a");
  });

  it("returns red for error", () => {
    expect(variantColor("error")).toBe("#e85454");
  });

  it("returns gray for muted", () => {
    expect(variantColor("muted")).toBe("#888888");
  });

  it("returns fallback for default variant", () => {
    expect(variantColor("default", "#aaa")).toBe("#aaa");
  });

  it("returns fallback for undefined variant", () => {
    expect(variantColor(undefined, "#bbb")).toBe("#bbb");
  });

  it("returns 'inherit' when no fallback and default variant", () => {
    expect(variantColor("default")).toBe("inherit");
  });
});

describe("aggregateAgentBadges", () => {
  it("returns empty array for no items", () => {
    expect(aggregateAgentBadges([])).toEqual([]);
  });

  it("groups items by variant and counts", () => {
    const items = [
      makeStatusItem({ id: "a1", variant: "success" }),
      makeStatusItem({ id: "a2", variant: "success" }),
      makeStatusItem({ id: "a3", variant: "warning" }),
    ];
    const badges = aggregateAgentBadges(items);
    expect(badges).toHaveLength(2);
    expect(badges[0]).toMatchObject({
      label: "2 running",
      count: 2,
      variant: "success",
    });
    expect(badges[1]).toMatchObject({
      label: "1 waiting",
      count: 1,
      variant: "warning",
    });
  });

  it("orders badges: running, waiting, idle", () => {
    const items = [
      makeStatusItem({ id: "a1", variant: "muted" }),
      makeStatusItem({ id: "a2", variant: "success" }),
      makeStatusItem({ id: "a3", variant: "warning" }),
    ];
    const badges = aggregateAgentBadges(items);
    expect(badges.map((b) => b.variant)).toEqual([
      "success",
      "warning",
      "muted",
    ]);
  });

  it("assigns correct colors to badges", () => {
    const items = [
      makeStatusItem({ id: "a1", variant: "success" }),
      makeStatusItem({ id: "a2", variant: "muted" }),
    ];
    const badges = aggregateAgentBadges(items);
    expect(badges[0].color).toBe("#4ec957");
    expect(badges[1].color).toBe("#888888");
  });
});

describe("agentDotColorForPane", () => {
  it("returns null for no matching items", () => {
    expect(agentDotColorForPane([], "pane-1")).toBeNull();
  });

  it("returns null when no items have matching paneId", () => {
    const items = [
      makeStatusItem({
        id: "a1",
        variant: "success",
        metadata: { paneId: "pane-2" },
      }),
    ];
    expect(agentDotColorForPane(items, "pane-1")).toBeNull();
  });

  it("returns green for running agent in pane", () => {
    const items = [
      makeStatusItem({
        id: "a1",
        variant: "success",
        metadata: { paneId: "pane-1" },
      }),
    ];
    expect(agentDotColorForPane(items, "pane-1")).toBe("#4ec957");
  });

  it("returns yellow for waiting agent in pane", () => {
    const items = [
      makeStatusItem({
        id: "a1",
        variant: "warning",
        metadata: { paneId: "pane-1" },
      }),
    ];
    expect(agentDotColorForPane(items, "pane-1")).toBe("#e8b73a");
  });

  it("returns null for idle-only agents (muted variant)", () => {
    const items = [
      makeStatusItem({
        id: "a1",
        variant: "muted",
        metadata: { paneId: "pane-1" },
      }),
    ];
    expect(agentDotColorForPane(items, "pane-1")).toBeNull();
  });

  it("returns highest severity: error over success", () => {
    const items = [
      makeStatusItem({
        id: "a1",
        variant: "success",
        metadata: { paneId: "pane-1" },
      }),
      makeStatusItem({
        id: "a2",
        variant: "error",
        metadata: { paneId: "pane-1" },
      }),
    ];
    expect(agentDotColorForPane(items, "pane-1")).toBe("#e85454");
  });

  it("returns highest severity: success over warning", () => {
    const items = [
      makeStatusItem({
        id: "a1",
        variant: "warning",
        metadata: { paneId: "pane-1" },
      }),
      makeStatusItem({
        id: "a2",
        variant: "success",
        metadata: { paneId: "pane-1" },
      }),
    ];
    expect(agentDotColorForPane(items, "pane-1")).toBe("#4ec957");
  });
});
