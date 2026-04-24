import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const WORKSPACE_LIST_BLOCK = readFileSync(
  "src/lib/components/WorkspaceListBlock.svelte",
  "utf-8",
).replace(/\s+/g, " ");

const GROUP_SECTION_CONTENT = readFileSync(
  "src/lib/components/WorkspaceGroupSectionContent.svelte",
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

  it("core bootstrap registers color + label resolvers on the row renderer", () => {
    // Core (bootstrap/init-workspace-groups.ts) provides the resolvers
    // so core can paint the group's overlay and ghost without reaching
    // into extension state directly.
    const BOOTSTRAP = readFileSync(
      "src/lib/bootstrap/init-workspace-groups.ts",
      "utf-8",
    );
    expect(BOOTSTRAP).toMatch(/railColor:/);
    expect(BOOTSTRAP).toMatch(/label:/);
    expect(BOOTSTRAP).toMatch(/resolveProjectColor/);
  });

  it("WorkspaceGroupSectionContent accepts a unified overlay prop supporting strong + light", () => {
    expect(GROUP_SECTION_CONTENT).toMatch(/export let overlay/);
    expect(GROUP_SECTION_CONTENT).toMatch(/kind:\s*"strong"/);
    expect(GROUP_SECTION_CONTENT).toMatch(/kind:\s*"light"/);
  });

  it("WorkspaceGroupSectionContent renders one overlay spanning the whole group block; label only for strong", () => {
    expect(GROUP_SECTION_CONTENT).toMatch(/\{#if overlay\}/);
    expect(GROUP_SECTION_CONTENT).toMatch(/overlay\.kind\s*===\s*"strong"/);
    expect(GROUP_SECTION_CONTENT).toMatch(/overlay\.label/);
  });

  it("WorkspaceGroupSectionContent paints the strong overlay with the group's own color", () => {
    // Non-source groups during a group drag render a solid colored
    // tile using the theme-resolved group color.
    expect(GROUP_SECTION_CONTENT).toMatch(
      /overlay\.kind\s*===\s*["']strong["'][\s\S]*?groupHex/,
    );
    expect(GROUP_SECTION_CONTENT).toMatch(
      /groupHex\s*=\s*[^\n]*resolveProjectColor\(group\.color,\s*\$theme\)/,
    );
  });

  it("WorkspaceGroupSectionContent uses the light dim (black-40) for the light variant", () => {
    expect(GROUP_SECTION_CONTENT).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.4\)/);
  });
});
