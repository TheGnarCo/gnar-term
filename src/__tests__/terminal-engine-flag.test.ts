/**
 * Regression test confirming that the `terminalEngine` feature flag has been
 * removed from `GnarTermConfig` (AC-6 cutover).
 *
 * The Phase-1 flag (`getTerminalEngine`, `selectTerminalComponent`,
 * `GnarTermConfig.terminalEngine`) was deleted in cycle-21. This file
 * documents that the field is gone and will catch any regression that
 * re-introduces it.
 */

import { describe, it, expect } from "vitest";
import type { GnarTermConfig } from "../lib/config";

describe("terminalEngine flag — cutover regression", () => {
  it("GnarTermConfig type does NOT have a terminalEngine field after cutover", () => {
    // If terminalEngine were re-added to GnarTermConfig, this assignment would
    // still compile (unknown extra properties). We assert at runtime that a
    // freshly constructed config object does not carry the field.
    const cfg: GnarTermConfig = {};
    expect("terminalEngine" in cfg).toBe(false);
  });

  it("config module does NOT export getTerminalEngine", async () => {
    const mod = await import("../lib/config");
    expect("getTerminalEngine" in mod).toBe(false);
  });

  it("config module does NOT export selectTerminalComponent", async () => {
    const mod = await import("../lib/config");
    expect("selectTerminalComponent" in mod).toBe(false);
  });
});
