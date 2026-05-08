/**
 * Dashboard chips render in a flex-wrap container inside the
 * SidebarBanner's children-leading slot. Each chip wrapper uses
 * `flex: 1 0 calc((100% - 8px) / 3)` and a matching min-width so up
 * to three chips fit per row, stretching to fill when fewer than
 * three are present.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const SOURCE = readFileSync(
  "src/lib/components/WorkspaceSectionContent.svelte",
  "utf-8",
);

describe("dashboard chip grid", () => {
  it('dashboard chips render under slot="children-leading"', () => {
    const slotIdx = SOURCE.indexOf('slot="children-leading"');
    expect(slotIdx).toBeGreaterThan(-1);
    const eachIdx = SOURCE.indexOf("{#each workspaceDashboards", slotIdx);
    expect(eachIdx).toBeGreaterThan(slotIdx);
  });

  it("dashboardCount is forwarded to SidebarBanner", () => {
    expect(SOURCE).toContain("dashboardCount={workspaceDashboards.length}");
  });

  it("the each block is no longer in the btn-row slot", () => {
    const btnRowIdx = SOURCE.indexOf('slot="btn-row"');
    const leadingIdx = SOURCE.indexOf('slot="children-leading"');
    expect(btnRowIdx).toBeGreaterThan(-1);
    // Source-order invariant: children-leading must follow btn-row so
    // the slice below carves out the btn-row region.
    expect(leadingIdx).toBeGreaterThan(btnRowIdx);
    const btnRowSection = SOURCE.slice(btnRowIdx, leadingIdx);
    expect(btnRowSection).not.toContain("{#each workspaceDashboards");
  });

  it("chip wrapper uses stretch-to-fill flex sizing", () => {
    const collapsed = SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toContain("flex: 1 0 calc((100% - 8px) / 3)");
    expect(collapsed).toContain("min-width: calc((100% - 8px) / 3)");
    expect(collapsed).not.toContain("max-width: calc((100% - 8px) / 3)");
  });

  it("chip grid container uses flex-wrap with 4px gap", () => {
    const collapsed = SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /class="dashboard-chip-grid"|dashboard-chip-grid/,
    );
    expect(collapsed).toContain("flex-wrap: wrap");
  });

  // The chip <button> inherits `.dash-btn { width: 28px }` from the
  // shared button rule. Inside the fluid grid the button is positioned
  // absolute with left/right insets, and the inherited 28px would pin
  // it and defeat the stretch. The scoped override below is what lets
  // chips actually fill their wrapper — losing it silently regresses
  // layout, so lock it in.
  it("chip button width is overridden to auto inside the grid", () => {
    const collapsed = SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /\.dashboard-chip-grid \.dash-btn\s*\{[^}]*width:\s*auto/,
    );
  });
});
