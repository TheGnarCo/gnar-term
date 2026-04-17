/**
 * Source-scanning tests for ProjectSectionContent.svelte — verifies
 * the template contract after the project header polish refactor:
 * colored dot, clickable title → dashboard, no dashboard link row,
 * no legacy border/typography.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const SOURCE = readFileSync(
  "src/extensions/project-scope/ProjectSectionContent.svelte",
  "utf-8",
);

describe("ProjectSectionContent template", () => {
  it("does not render the legacy border-left accent on the header", () => {
    expect(SOURCE).not.toMatch(/border-left:\s*3px solid \{project\.color\}/);
  });

  it("does not use uppercase/letter-spacing/10px typography for the name", () => {
    expect(SOURCE).not.toMatch(/text-transform:\s*uppercase/);
    expect(SOURCE).not.toMatch(/letter-spacing:\s*0\.5px/);
    expect(SOURCE).not.toMatch(/font-size:\s*10px/);
  });

  it("renders an 8×8 colored dot backed by project.color", () => {
    // Normalize whitespace for style-attr matching.
    const oneLine = SOURCE.replace(/\s+/g, " ");
    expect(oneLine).toMatch(
      /width:\s*8px;\s*height:\s*8px;\s*border-radius:\s*50%;\s*background:\s*\{project\.color\}/,
    );
  });

  it("makes the header name clickable and opens the project dashboard", () => {
    const oneLine = SOURCE.replace(/\s+/g, " ");
    // Click handler sets dashboardProjectId$ for the current project.
    expect(oneLine).toMatch(
      /on:click=\{\(\) => \{ if \(project\) dashboardProjectId\$\.set\(project\.id\); \}\}/,
    );
  });

  it("does not render a separate 'Dashboard' link row", () => {
    expect(SOURCE).not.toMatch(/<!--\s*Dashboard link\s*-->/);
    // The old row rendered the literal word "Dashboard" as a boxed span.
    // Verify no top-level Dashboard label remains in the template body.
    const withoutImports = SOURCE.replace(/<script[\s\S]*?<\/script>/, "");
    expect(withoutImports).not.toContain("Dashboard");
  });

  it("uses 13px / 600 / theme.fg typography for the project name", () => {
    const oneLine = SOURCE.replace(/\s+/g, " ");
    expect(oneLine).toMatch(
      /font-size:\s*13px;\s*font-weight:\s*600;\s*color:\s*\{\$theme\.fg\}/,
    );
  });
});
