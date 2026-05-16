/**
 * pane-view-dispatch.test.ts
 *
 * Tests for the terminal engine dispatch decision in PaneView.
 *
 * PaneView.svelte selects between TerminalSurface and AlacrittyTerminalSurface
 * based on `getTerminalEngine()`. The dispatch logic is extracted into the pure
 * function `selectTerminalComponent` so it can be unit-tested without a DOM
 * or Svelte rendering environment.
 *
 * AC keywords: dispatch, pane
 */

import { describe, it, expect } from "vitest";
import { selectTerminalComponent } from "../lib/config";

describe("pane dispatch: selectTerminalComponent", () => {
  it('dispatch with engine "xterm" selects TerminalSurface', () => {
    expect(selectTerminalComponent("xterm")).toBe("TerminalSurface");
  });

  it('dispatch with engine "alacritty" selects AlacrittyTerminalSurface', () => {
    expect(selectTerminalComponent("alacritty")).toBe(
      "AlacrittyTerminalSurface",
    );
  });

  it('dispatch values "xterm" and "alacritty" produce different component selections', () => {
    const xtermResult = selectTerminalComponent("xterm");
    const alacrittyResult = selectTerminalComponent("alacritty");
    expect(xtermResult).not.toBe(alacrittyResult);
  });

  it("dispatch: xterm selection is the default (non-alacritty) component", () => {
    const result = selectTerminalComponent("xterm");
    expect(result).toBe("TerminalSurface");
    expect(result).not.toBe("AlacrittyTerminalSurface");
  });

  it("dispatch: alacritty selection is not the xterm component", () => {
    const result = selectTerminalComponent("alacritty");
    expect(result).toBe("AlacrittyTerminalSurface");
    expect(result).not.toBe("TerminalSurface");
  });
});
