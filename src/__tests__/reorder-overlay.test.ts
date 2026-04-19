import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const WORKSPACE_LIST_BLOCK = readFileSync(
  "src/lib/components/WorkspaceListBlock.svelte",
  "utf-8",
).replace(/\s+/g, " ");

const PROJECT_SECTION_CONTENT = readFileSync(
  "src/extensions/project-scope/ProjectSectionContent.svelte",
  "utf-8",
).replace(/\s+/g, " ");

describe("root-row overlay (WorkspaceListBlock)", () => {
  it("paints an isSibling overlay on every non-source root row during a drag", () => {
    // Unified drag now covers both workspace and project rows at the
    // root level; sibling rows paint an opaque tile with the row's
    // own label centered.
    expect(WORKSPACE_LIST_BLOCK).toMatch(
      /isSibling\s*=\s*dragActive\s*&&\s*dragSourceIdx\s*!==\s*entry\.idx/,
    );
    expect(WORKSPACE_LIST_BLOCK).toMatch(/\{#if isSibling\}/);
    expect(WORKSPACE_LIST_BLOCK).toMatch(/position:\s*absolute;\s*inset:\s*0/);
  });

  it("source row hides (display: none) instead of dimming", () => {
    expect(WORKSPACE_LIST_BLOCK).toMatch(
      /display:\s*\{\s*isSource\s*\?\s*'none'\s*:\s*'block'\s*\}/,
    );
  });

  it("publishes a rootRow ReorderContext with the sourceKind + sourceId", () => {
    // Overlay resolvers in row renderers (ProjectRowBody) gate off
    // this context shape.
    expect(WORKSPACE_LIST_BLOCK).toMatch(/kind:\s*"rootRow"/);
    expect(WORKSPACE_LIST_BLOCK).toMatch(/sourceKind:\s*src\.kind/);
    expect(WORKSPACE_LIST_BLOCK).toMatch(/sourceId:\s*src\.id/);
    expect(WORKSPACE_LIST_BLOCK).toMatch(
      /containerBlockId:\s*"__workspaces__"/,
    );
  });
});

describe("per-project overlay (via WorkspaceListBlock shell)", () => {
  it("core reads the renderer's railColor + label resolvers for the overlay", () => {
    // Core (WorkspaceListBlock) paints the sibling overlay using
    // metadata the renderer contributed via registerRootRowRenderer's
    // railColor + label options — so a project row reads as its own
    // colored tile with its name centered during drag.
    expect(WORKSPACE_LIST_BLOCK).toMatch(/rendererRailColor/);
    expect(WORKSPACE_LIST_BLOCK).toMatch(/rendererLabel/);
  });

  it("project-scope registers color + label resolvers on the row renderer", () => {
    // project-scope provides the resolvers so core can paint the
    // project's overlay and ghost without reaching into extension
    // state directly.
    const PROJECT_SCOPE = readFileSync(
      "src/extensions/project-scope/index.ts",
      "utf-8",
    );
    expect(PROJECT_SCOPE).toMatch(/railColor:/);
    expect(PROJECT_SCOPE).toMatch(/label:/);
    expect(PROJECT_SCOPE).toMatch(/resolveProjectColor/);
  });

  it("ProjectSectionContent accepts a unified overlay prop supporting strong + light", () => {
    expect(PROJECT_SECTION_CONTENT).toMatch(/export let overlay/);
    expect(PROJECT_SECTION_CONTENT).toMatch(/kind:\s*"strong"/);
    expect(PROJECT_SECTION_CONTENT).toMatch(/kind:\s*"light"/);
  });

  it("ProjectSectionContent renders one overlay spanning the whole project block; label only for strong", () => {
    expect(PROJECT_SECTION_CONTENT).toMatch(/\{#if overlay\}/);
    expect(PROJECT_SECTION_CONTENT).toMatch(/overlay\.kind\s*===\s*"strong"/);
    expect(PROJECT_SECTION_CONTENT).toMatch(/overlay\.label/);
  });

  it("ProjectSectionContent paints the strong overlay with the project's own color", () => {
    // Non-source projects during a project drag render a solid colored
    // tile using the theme-resolved project color.
    expect(PROJECT_SECTION_CONTENT).toMatch(
      /overlay\.kind\s*===\s*["']strong["'][\s\S]*?projectHex/,
    );
    expect(PROJECT_SECTION_CONTENT).toMatch(
      /projectHex\s*=\s*[^\n]*resolveProjectColor\(project\.color,\s*\$theme\)/,
    );
  });

  it("ProjectSectionContent uses the light dim (black-40) for the light variant", () => {
    expect(PROJECT_SECTION_CONTENT).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.4\)/);
  });
});
