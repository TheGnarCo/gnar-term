/**
 * Dashboard buttons in WorkspaceSectionContent's btn-row slot render
 * icon-only: no text label, workspace name lives in the `aria-label`
 * attribute. Regression for the redesign that moved dashboard tiles
 * from WorkspaceListView's grid into the ContainerRow btn-row slot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const SOURCE = readFileSync(
  "src/lib/components/WorkspaceSectionContent.svelte",
  "utf-8",
).replace(/\s+/g, " ");

describe("dashboard btn-row — icon only", () => {
  it("renders data-dashboard-item and data-dashboard-contribution on each button", () => {
    expect(SOURCE).toContain("data-dashboard-item={entry.ws.id}");
    expect(SOURCE).toContain("data-dashboard-contribution={contribId}");
  });

  it("preserves the workspace name in the button's aria-label attribute", () => {
    expect(SOURCE).toContain("aria-label={entry.ws.name}");
  });

  it("uses DashboardTileIcon for icon rendering (icon-only, no label)", () => {
    expect(SOURCE).toContain("DashboardTileIcon");
    expect(SOURCE).not.toContain("dashboard-tile-label");
  });

  it("pins the Settings dashboard last by splitting it from non-settings dashboards", () => {
    // Non-settings dashboards render first; tile actions render next; the
    // Settings dashboard renders just before the expand toggle. The split
    // happens at the data layer rather than via a sort-and-suffix pass.
    expect(SOURCE).toContain('dashboardContributionId !== "settings"');
    expect(SOURCE).toContain('dashboardContributionId === "settings"');
    expect(SOURCE).toContain("nonSettingsDashboards");
    expect(SOURCE).toContain("settingsDashboard");
    // The non-settings each block runs before the settings render block.
    const nonSettingsIdx = SOURCE.indexOf("{#each nonSettingsDashboards");
    const settingsIdx = SOURCE.indexOf("{#if settingsDashboard}");
    expect(nonSettingsIdx).toBeGreaterThan(-1);
    expect(settingsIdx).toBeGreaterThan(nonSettingsIdx);
  });

  it("applies active ring using workspace color", () => {
    expect(SOURCE).toContain("box-shadow: 0 0 0 1.5px ${workspaceHex}");
  });
});
