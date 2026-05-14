import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Regression: the accent-colored focus ring used to apply via a bare
 * `:global(:focus-visible)` selector, which painted a stray outline around
 * the main work area whenever the auto-default Terminal workspace
 * programmatically focused the xterm helper textarea on first launch. The
 * fix scopes the rule to actual interactive controls so non-interactive
 * containers (the work area, xterm wrappers, `<body>`) never match.
 */
describe("focus-visible outline scope (App.svelte)", () => {
  const appSource = readFileSync(
    resolve(process.cwd(), "src/App.svelte"),
    "utf8",
  );

  it("does not declare a bare :global(:focus-visible) outline rule", () => {
    expect(appSource).not.toMatch(/:global\(\s*:focus-visible\s*\)\s*\{/);
  });

  it("scopes the accent focus-ring rule to interactive selectors", () => {
    const interactiveSelectors = [
      "button",
      '[role="button"]',
      '[role="tab"]',
      "a[href]",
      "input",
      "textarea",
      "select",
    ];
    for (const selector of interactiveSelectors) {
      expect(
        appSource,
        `expected the scoped focus-visible rule to include \`${selector}\``,
      ).toContain(selector);
    }
  });

  it("retains the .no-default-outline opt-in escape hatch", () => {
    expect(appSource).toMatch(
      /:global\(\.no-default-outline:focus-visible\)\s*\{/,
    );
  });
});
