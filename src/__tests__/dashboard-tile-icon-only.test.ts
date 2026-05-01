/**
 * Dashboard buttons in WorkspaceSectionContent's btn-row slot render
 * icon-only: no text label, workspace name lives in the `title` attribute.
 * Regression for the redesign that moved dashboard tiles from
 * WorkspaceListView's grid into the ContainerRow btn-row slot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const GROUP_SECTION = readFileSync(
  "src/lib/components/WorkspaceSectionContent.svelte",
  "utf-8",
).replace(/\s+/g, " ");

describe("dashboard btn-row — icon only", () => {
  it("renders data-dashboard-item and data-dashboard-contribution on each button", () => {
    expect(GROUP_SECTION).toContain("data-dashboard-item={entry.ws.id}");
    expect(GROUP_SECTION).toContain("data-dashboard-contribution={contribId}");
  });

  it("preserves the workspace name in the button's title attribute", () => {
    expect(GROUP_SECTION).toContain("title={entry.ws.name}");
  });

  it("uses DashboardTileIcon for icon rendering (icon-only, no label)", () => {
    expect(GROUP_SECTION).toContain("DashboardTileIcon");
    expect(GROUP_SECTION).not.toContain("dashboard-tile-label");
  });

  it("pins the Settings dashboard last via sort", () => {
    expect(GROUP_SECTION).toContain('dashboardContributionId === "settings"');
    expect(GROUP_SECTION).toContain("return aS ? 1 : -1");
  });

  it("applies active ring using group color", () => {
    expect(GROUP_SECTION).toContain("box-shadow: 0 0 0 1.5px ${workspaceHex}");
  });
});
