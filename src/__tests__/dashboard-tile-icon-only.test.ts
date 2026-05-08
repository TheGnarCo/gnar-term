/**
 * Dashboard buttons in WorkspaceSectionContent render under the
 * SidebarBanner's `children-leading` slot (above the branched
 * workspace list), as icon-only tiles in a stretch-to-fill grid.
 * Each tile drives a registered DashboardContribution (not a
 * dashboard workspace), and clicking it routes through
 * `contribution.openAsTab(workspace)` so the dashboard opens as a
 * tab inside the workspace's pane.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const SOURCE = readFileSync(
  "src/lib/components/WorkspaceSectionContent.svelte",
  "utf-8",
).replace(/\s+/g, " ");

describe("dashboard btn-row — icon only", () => {
  it("renders data-dashboard-item and data-dashboard-contribution on each button", () => {
    expect(SOURCE).toContain("data-dashboard-item={contribution.id}");
    expect(SOURCE).toContain("data-dashboard-contribution={contribution.id}");
  });

  it("preserves the contribution label in the button's aria-label attribute", () => {
    expect(SOURCE).toContain("aria-label={contribution.label}");
  });

  it("uses DashboardTileIcon for icon rendering (icon-only, no label)", () => {
    expect(SOURCE).toContain("DashboardTileIcon");
    expect(SOURCE).not.toContain("dashboard-tile-label");
  });

  it("excludes auto-provisioned dashboards (e.g. Settings) from the chip grid", () => {
    expect(SOURCE).toContain("workspaceDashboards");
    expect(SOURCE).toContain("{#each workspaceDashboards");
    // Settings (the only autoProvision contribution today) is filtered
    // out via `c.autoProvision` and surfaced via the banner-end gear chip
    // instead of a tile.
    expect(SOURCE).toContain("c.autoProvision");
  });

  it('renders chips under slot="children-leading", not in btn-row', () => {
    const btnRowIdx = SOURCE.indexOf('slot="btn-row"');
    const leadingIdx = SOURCE.indexOf('slot="children-leading"');
    expect(btnRowIdx).toBeGreaterThan(-1);
    expect(leadingIdx).toBeGreaterThan(btnRowIdx);
    const btnRowSection = SOURCE.slice(btnRowIdx, leadingIdx);
    expect(btnRowSection).not.toContain("{#each workspaceDashboards");
  });

  it("chip click routes through contribution.openAsTab — dashboards are tabs, not workspaces", () => {
    expect(SOURCE).toContain("contribution.openAsTab(workspace)");
    // The OLD model fell back to switchWorkspace; in the dashboards-as-tabs
    // model every contribution implements openAsTab and there is no
    // separate dashboard workspace to switch to.
    expect(SOURCE).not.toContain("switchWorkspace(entry.idx)");
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

  it("derives chip presence from persisted Settings state via isDashboardContributionEnabled (NOT live tab state)", () => {
    // Chips are persistent affordances tied to the per-workspace toggle,
    // not to whether a dashboard tab is currently open. Closing a tab
    // must NOT remove its chip — the user re-opens it by clicking the chip.
    expect(SOURCE).toContain("isDashboardContributionEnabled");
    expect(SOURCE).not.toContain("isDashboardContributionTabActive");
  });
});
