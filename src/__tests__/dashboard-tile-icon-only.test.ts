/**
 * Dashboard buttons in WorkspaceSectionContent render under the
 * SidebarBanner's `children-leading` slot (above the branched
 * workspace list), as icon-only tiles in a stretch-to-fill grid.
 * Workspace name lives in `aria-label`. Regression for the move out
 * of the banner btn-row.
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

  it("excludes auto-provisioned dashboards (e.g. Settings) from the chip grid", () => {
    expect(SOURCE).toContain("workspaceDashboards");
    expect(SOURCE).toContain("{#each workspaceDashboards");
    expect(SOURCE).toContain("contribution?.autoProvision");
    expect(SOURCE).not.toContain(
      "{#if settingsDashboard} {@render dashboardChip(settingsDashboard)}",
    );
  });

  it('renders chips under slot="children-leading", not in btn-row', () => {
    const btnRowIdx = SOURCE.indexOf('slot="btn-row"');
    const leadingIdx = SOURCE.indexOf('slot="children-leading"');
    expect(btnRowIdx).toBeGreaterThan(-1);
    expect(leadingIdx).toBeGreaterThan(btnRowIdx);
    const btnRowSection = SOURCE.slice(btnRowIdx, leadingIdx);
    expect(btnRowSection).not.toContain("{#each workspaceDashboards");
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
