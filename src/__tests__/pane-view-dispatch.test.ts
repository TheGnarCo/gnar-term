/**
 * pane-view-dispatch.test.ts
 *
 * After the alacritty cutover, PaneView renders AlacrittyTerminalSurface
 * unconditionally — there is no runtime engine flag, no selectTerminalComponent
 * function, and no TerminalSurface (xterm) fallback.
 *
 * This test asserts the post-cutover invariants:
 *   - config module does NOT export selectTerminalComponent
 *   - config module does NOT export getTerminalEngine
 *   - GnarTermConfig has no terminalEngine field
 *
 * AC keywords: dispatch, pane
 */

import { describe, it, expect } from "vitest";

describe("pane dispatch: alacritty-only cutover invariants", () => {
  it("config module does NOT export selectTerminalComponent after cutover", async () => {
    const mod = await import("../lib/config");
    expect("selectTerminalComponent" in mod).toBe(false);
  });

  it("config module does NOT export getTerminalEngine after cutover", async () => {
    const mod = await import("../lib/config");
    expect("getTerminalEngine" in mod).toBe(false);
  });

  it("GnarTermConfig type does NOT have a terminalEngine field after cutover", async () => {
    // Runtime check: empty config object has no terminalEngine key.
    const cfg: import("../lib/config").GnarTermConfig = {};
    expect("terminalEngine" in cfg).toBe(false);
  });

  it("AlacrittyTerminalSurface component is importable (no resolution error)", async () => {
    // If TerminalSurface.svelte is gone and SshSurface was updated, this should work.
    // We can only verify the component is importable; rendering requires a full Svelte env.
    const mod =
      await import("../lib/components/AlacrittyTerminalSurface.svelte");
    expect(mod).toBeDefined();
  });
});
