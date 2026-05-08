/**
 * Dashboard buttons in WorkspaceSectionContent's btn-row slot render
 * icon-only: no text label, workspace name lives in the `aria-label`
 * attribute. Regression for the redesign that moved dashboard tiles
 * from WorkspaceListView's grid into the SidebarBanner btn-row slot.
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

  it("excludes auto-provisioned dashboards (e.g. Settings) from the btn-row chips", () => {
    // Auto-provisioned dashboards have dedicated UI (e.g. Settings via
    // the banner-end gear) and must not appear as user-clickable chips.
    // The filter now keys off contribution.autoProvision rather than a
    // hardcoded "settings" id so any future auto-provisioned
    // contribution is hidden by the same rule.
    expect(SOURCE).toContain("workspaceDashboards");
    expect(SOURCE).toContain("{#each workspaceDashboards");
    expect(SOURCE).toContain("contribution?.autoProvision");
    // The {#if settingsDashboard} block in btn-row that rendered the
    // Settings chip after non-settings dashboards has been removed.
    expect(SOURCE).not.toContain(
      "{#if settingsDashboard} {@render dashboardChip(settingsDashboard)}",
    );
  });

  it("chip click prefers contribution.openAsTab over switchWorkspace", () => {
    // Workspace-level dashboards (overview, agentic, diff) implement
    // openAsTab to open inline as tabs in the parent workspace rather
    // than switching to a separate dashboard workspace. The chip
    // onClick falls back to switchWorkspace only when the contribution
    // does not provide openAsTab.
    expect(SOURCE).toContain("contribution?.openAsTab");
    expect(SOURCE).toContain("contribution.openAsTab(workspace)");
    expect(SOURCE).toContain("switchWorkspace(entry.idx)");
  });

  it("renders a settings gear chip in banner-end on hover, before the close chip", () => {
    // On banner hover, the gear chip appears to the LEFT of the close
    // chip; clicking it opens the Settings panel as a NEW TAB inside
    // the workspace's own pane (not as a separate dashboard workspace).
    expect(SOURCE).toContain('variant="settings"');
    expect(SOURCE).toContain("openWorkspaceSettingsTab(workspace!.id)");
    const gearIdx = SOURCE.indexOf('variant="settings"');
    const closeIdx = SOURCE.indexOf('variant="close"');
    expect(gearIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(gearIdx);
  });

  it("applies active ring using workspace color", () => {
    expect(SOURCE).toContain("box-shadow: 0 0 0 1.5px ${workspaceHex}");
  });
});
