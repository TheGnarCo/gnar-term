import { describe, it, expect } from "vitest";
import { sanitize } from "../sanitize";

// Pinned to the bash implementation in
// ~/.claude/plugins/marketplaces/gnar/spacebase/skills/spacebase-api/scripts/spacebase-helpers.sh:
//   tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]/-/g; s/[^a-z0-9._-]//g'
//
// That is: lowercase, then replace each whitespace char with '-', then strip
// any character that is not in [a-z0-9._-]. No edge-trimming, no run-collapsing.

describe("sanitize (mirrors spacebase-sync.sh sanitize())", () => {
  it("lowercases ASCII letters", () => {
    expect(sanitize("HELLO")).toBe("hello");
  });

  it("converts a single space to a hyphen", () => {
    expect(sanitize("Hello World")).toBe("hello-world");
  });

  it("preserves consecutive whitespace as multiple hyphens (bash does not collapse runs)", () => {
    expect(sanitize("Spaces  Run")).toBe("spaces--run");
  });

  it("treats tabs as whitespace (replaced with hyphen)", () => {
    expect(sanitize("a\tb")).toBe("a-b");
  });

  it("does not trim leading/trailing whitespace before substitution", () => {
    expect(sanitize("  leading and trailing  ")).toBe(
      "--leading-and-trailing--",
    );
  });

  it("strips characters outside [a-z0-9._-]", () => {
    expect(sanitize("Foo!@#bar")).toBe("foobar");
  });

  it("preserves dot, underscore, and hyphen", () => {
    expect(sanitize("PRD_v1.0-final")).toBe("prd_v1.0-final");
  });

  it("strips non-ASCII letters (bash byte-level regex)", () => {
    // 'café' lowercased then non-ASCII bytes stripped
    expect(sanitize("café")).toBe("caf");
  });

  it("keeps digits", () => {
    expect(sanitize("123 numbers")).toBe("123-numbers");
  });

  it("returns empty string for empty input", () => {
    expect(sanitize("")).toBe("");
  });
});
