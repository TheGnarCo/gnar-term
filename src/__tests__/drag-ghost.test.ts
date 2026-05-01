/**
 * Regression tests: drag-preview should match drop-result.
 *
 * Prior UX: the source dimmed to 0.4 and a 2px accent line marked the
 * insert position. Releasing produced a jarring jump because the line
 * didn't communicate size or final position.
 *
 * New UX: the source element is hidden (`display: none`) while
 * dragging, and a same-size `DropGhost` placeholder occupies the drop
 * target. Releasing "fills in" the ghost slot with the real item.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

/** Extract the body of a function by balancing braces. */
function extractFn(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  if (open < 0) return "";
  let depth = 1;
  let i = open + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return source.slice(start, i);
}

describe("drag-reorder state exposes source height", () => {
  const DRAG_REORDER = read("src/lib/actions/drag-reorder.ts");
  const EXT_API = read("src/extensions/api.ts");

  it("DragReorderState declares sourceHeight", () => {
    expect(DRAG_REORDER).toMatch(/sourceHeight:\s*number/);
    expect(EXT_API).toMatch(/sourceHeight:\s*number/);
  });

  it("drag-reorder captures origin element height at drag start", () => {
    expect(DRAG_REORDER).toMatch(/originEl\?\.offsetHeight/);
  });

  it("getState returns sourceHeight alongside the existing fields", () => {
    expect(DRAG_REORDER).toMatch(
      /getState:\s*\(\)\s*=>\s*\(\{[^}]*sourceHeight/,
    );
  });

  it("sourceHeight resets on drag teardown", () => {
    const teardown = extractFn(DRAG_REORDER, "teardownDrag");
    expect(teardown).toMatch(/sourceHeight\s*=\s*0/);
  });

  it("parks the initial indicator at the source's own slot on drag start", () => {
    // When a drag starts, the source hides (`display: none`) — without
    // seeding the indicator, the list would collapse by one row until
    // the cursor entered a valid target. The fix anchors the ghost at
    // the source's position so the layout stays stable.
    const oneLine = DRAG_REORDER.replace(/\s+/g, " ");
    expect(oneLine).toMatch(
      /indicator\s*=\s*\{\s*idx\s*,\s*edge:\s*"before"\s*\}/,
    );
  });

  it("sticks at the last valid drop target when the cursor leaves the drop zone", () => {
    // When the cursor moves above/below the list or over a non-item
    // area, onDragMove must NOT reset the indicator — it stays at
    // whatever valid position it reached last. The user expects the
    // drop slot to "stick" there instead of snapping back.
    const fn = extractFn(DRAG_REORDER, "onDragMove");
    // No reassignment of indicator to sourceIndicator() / null inside
    // the out-of-bounds branches. The only assignments land inside the
    // "we found a valid item" branch.
    expect(fn).not.toMatch(/indicator\s*=\s*sourceIndicator\(\)/);
    expect(fn).not.toMatch(/indicator\s*=\s*null/);
  });
});

describe("DropGhost placeholder component", () => {
  const DROP_GHOST = read("src/lib/components/DropGhost.svelte");

  it("accepts theme, height, accent, and inset props", () => {
    expect(DROP_GHOST).toMatch(/export let theme/);
    expect(DROP_GHOST).toMatch(/export let height/);
    expect(DROP_GHOST).toMatch(/export let accent/);
    expect(DROP_GHOST).toMatch(/export let inset/);
  });

  it("renders an overlay-styled slot (scrim + dashed border) sized to the source", () => {
    // Dashed border differentiates the drop target (where it lands)
    // from non-source siblings during a drag. The floating cursor-
    // attached ghost stays normal-bordered.
    expect(DROP_GHOST).toMatch(/rgba\(40,\s*40,\s*40,\s*0\.[68]\)/);
    expect(DROP_GHOST).toMatch(/1px\s+dashed\s+rgba\(255,\s*255,\s*255/);
    expect(DROP_GHOST).toMatch(/height:\s*\{\s*height\s*\}\s*px/);
  });

  it("is pointer-events: none so it never intercepts the drop", () => {
    expect(DROP_GHOST).toMatch(/pointer-events:\s*none/);
  });
});

describe("drag source hides + ghost shows at target", () => {
  const WORKSPACE_ITEM = read("src/lib/components/WorkspaceItem.svelte");
  const LIST_BLOCK = read("src/lib/components/WorkspaceListBlock.svelte");
  const LIST_VIEW = read("src/lib/components/WorkspaceListView.svelte");

  it("WorkspaceItem hides its row (display: none) while dragActive", () => {
    const SIDEBAR_ELEM = read(
      "src/lib/components/PrimarySidebarElement.svelte",
    );
    expect(SIDEBAR_ELEM).toMatch(
      /display:\s*\{\s*isDragging\s*\?\s*'none'\s*:\s*'flex'\s*\}/,
    );
    // The old opacity-dim approach is gone.
    expect(WORKSPACE_ITEM).not.toMatch(
      /opacity:\s*\{\s*dragActive\s*\?\s*0\.4/,
    );
  });

  it("WorkspaceListBlock hides the dragged root row (display: none)", () => {
    // Root-level rows (workspace or project) hide their content while
    // being dragged; the DropGhost holds the slot.
    const oneLine = LIST_BLOCK.replace(/\s+/g, " ");
    expect(oneLine).toMatch(
      /display:\s*\{\s*isSource\s*\?\s*'none'\s*:\s*'block'\s*\}/,
    );
  });

  const consumers = [
    { name: "WorkspaceListBlock", src: LIST_BLOCK },
    { name: "WorkspaceListView", src: LIST_VIEW },
  ];

  for (const { name, src } of consumers) {
    it(`${name} renders DropGhost at the drop target`, () => {
      expect(src).toMatch(/DropGhost/);
    });

    it(`${name} no longer renders the legacy 2px insert line`, () => {
      const oneLine = src.replace(/\s+/g, " ");
      expect(oneLine).not.toMatch(
        /height:\s*2px;\s*background:[^;]+;\s*margin:\s*0\s+12px;\s*border-radius:\s*1px/,
      );
    });
  }
});

describe("root-workspace drag paints strong overlay on sibling rows", () => {
  // Mirrors the project-drag overlay: during a drag from the unclaimed
  // list, every non-source row paints an opaque tile (row color +
  // centered workspace name) so the drop context reads as a stack of
  // colored tiles rather than a field of unchanged rows.
  const LIST_BLOCK = read("src/lib/components/WorkspaceListBlock.svelte");

  it("derives isSibling from effectiveActive + effectiveDragSourceIdx", () => {
    expect(LIST_BLOCK).toMatch(
      /isSibling\s*=\s*effectiveActive\s*&&\s*effectiveDragSourceIdx\s*!==\s*entry\.idx/,
    );
  });

  it("does not render an overlay over non-source rows (items stay normal)", () => {
    const oneLine = LIST_BLOCK.replace(/\s+/g, " ");
    // Overlay removed per UX: non-source rows should not change appearance
    // during drag — only the drag ghost itself changes.
    expect(oneLine).not.toMatch(/\{#if isSibling\}/);
  });

  it("uses contrastColor against the row color for the overlay text", () => {
    expect(LIST_BLOCK).toMatch(/import\s+\{\s*contrastColor\s*\}/);
    expect(LIST_BLOCK).toMatch(/rowFg\s*=\s*contrastColor\(rowColor\)/);
  });

  it("labels the DropGhost with the source row's own label", () => {
    // The DropGhost tile reads as the dragged row (not the neighboring
    // row's name). The source row's label is derived from the root
    // row being dragged.
    expect(LIST_BLOCK).toMatch(/sourceRow\s*=/);
    expect(LIST_BLOCK).toMatch(/label=\{effectiveSourceRowLabel\}/);
  });
});

describe("contrast helper is shared across core components", () => {
  const CONTRAST = read("src/lib/utils/contrast.ts");

  it("exports contrastColor from a single module", () => {
    expect(CONTRAST).toMatch(/export function contrastColor/);
  });
});
