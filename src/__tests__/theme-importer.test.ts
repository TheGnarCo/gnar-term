/**
 * Theme importer — parses .itermcolors (XML plist) and base16 YAML files
 * into validated ThemeDef objects suitable for `registerTheme`.
 */
import { describe, it, expect } from "vitest";
import {
  parseItermColors,
  parseBase16Yaml,
} from "../lib/services/theme-importer";
import { validateTheme } from "../lib/services/theme-registry";

const ITERM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Background Color</key>
  <dict>
    <key>Red Component</key><real>0.0</real>
    <key>Green Component</key><real>0.0</real>
    <key>Blue Component</key><real>0.0</real>
  </dict>
  <key>Foreground Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>1.0</real>
    <key>Blue Component</key><real>1.0</real>
  </dict>
  <key>Cursor Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>1.0</real>
    <key>Blue Component</key><real>0.0</real>
  </dict>
  <key>Selection Color</key>
  <dict>
    <key>Red Component</key><real>0.2</real>
    <key>Green Component</key><real>0.2</real>
    <key>Blue Component</key><real>0.4</real>
  </dict>
  <key>Ansi 0 Color</key>
  <dict>
    <key>Red Component</key><real>0.1</real>
    <key>Green Component</key><real>0.1</real>
    <key>Blue Component</key><real>0.1</real>
  </dict>
  <key>Ansi 1 Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>0.0</real>
    <key>Blue Component</key><real>0.0</real>
  </dict>
  <key>Ansi 2 Color</key>
  <dict>
    <key>Red Component</key><real>0.0</real>
    <key>Green Component</key><real>1.0</real>
    <key>Blue Component</key><real>0.0</real>
  </dict>
  <key>Ansi 3 Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>1.0</real>
    <key>Blue Component</key><real>0.0</real>
  </dict>
  <key>Ansi 4 Color</key>
  <dict>
    <key>Red Component</key><real>0.0</real>
    <key>Green Component</key><real>0.0</real>
    <key>Blue Component</key><real>1.0</real>
  </dict>
  <key>Ansi 5 Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>0.0</real>
    <key>Blue Component</key><real>1.0</real>
  </dict>
  <key>Ansi 6 Color</key>
  <dict>
    <key>Red Component</key><real>0.0</real>
    <key>Green Component</key><real>1.0</real>
    <key>Blue Component</key><real>1.0</real>
  </dict>
  <key>Ansi 7 Color</key>
  <dict>
    <key>Red Component</key><real>0.75</real>
    <key>Green Component</key><real>0.75</real>
    <key>Blue Component</key><real>0.75</real>
  </dict>
  <key>Ansi 8 Color</key>
  <dict>
    <key>Red Component</key><real>0.5</real>
    <key>Green Component</key><real>0.5</real>
    <key>Blue Component</key><real>0.5</real>
  </dict>
  <key>Ansi 9 Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>0.5</real>
    <key>Blue Component</key><real>0.5</real>
  </dict>
  <key>Ansi 10 Color</key>
  <dict>
    <key>Red Component</key><real>0.5</real>
    <key>Green Component</key><real>1.0</real>
    <key>Blue Component</key><real>0.5</real>
  </dict>
  <key>Ansi 11 Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>1.0</real>
    <key>Blue Component</key><real>0.5</real>
  </dict>
  <key>Ansi 12 Color</key>
  <dict>
    <key>Red Component</key><real>0.5</real>
    <key>Green Component</key><real>0.5</real>
    <key>Blue Component</key><real>1.0</real>
  </dict>
  <key>Ansi 13 Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>0.5</real>
    <key>Blue Component</key><real>1.0</real>
  </dict>
  <key>Ansi 14 Color</key>
  <dict>
    <key>Red Component</key><real>0.5</real>
    <key>Green Component</key><real>1.0</real>
    <key>Blue Component</key><real>1.0</real>
  </dict>
  <key>Ansi 15 Color</key>
  <dict>
    <key>Red Component</key><real>1.0</real>
    <key>Green Component</key><real>1.0</real>
    <key>Blue Component</key><real>1.0</real>
  </dict>
</dict>
</plist>`;

const BASE16_FIXTURE = `scheme: "Test Scheme"
author: "Test Author"
base00: "1d1f21"
base01: "282a2e"
base02: "373b41"
base03: "969896"
base04: "b4b7b4"
base05: "c5c8c6"
base06: "e0e0e0"
base07: "ffffff"
base08: "cc6666"
base09: "de935f"
base0A: "f0c674"
base0B: "b5bd68"
base0C: "8abeb7"
base0D: "81a2be"
base0E: "b294bb"
base0F: "a3685a"
`;

describe("theme-importer", () => {
  describe("parseItermColors", () => {
    it("parses a minimal .itermcolors plist into a valid ThemeDef", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(() => validateTheme(t)).not.toThrow();
    });

    it("maps Background Color to bg/termBg", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(t.bg).toBe("#000000");
      expect(t.termBg).toBe("#000000");
    });

    it("maps Foreground Color to fg/termFg", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(t.fg).toBe("#ffffff");
      expect(t.termFg).toBe("#ffffff");
    });

    it("maps Cursor Color to termCursor", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(t.termCursor).toBe("#ffff00");
    });

    it("maps Selection Color to termSelection", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(t.termSelection).toBe("#333366");
    });

    it("maps Ansi 1 Color to ansi.red", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(t.ansi.red).toBe("#ff0000");
    });

    it("maps Ansi 4 Color to ansi.blue", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(t.ansi.blue).toBe("#0000ff");
    });

    it("maps Ansi 12 Color to ansi.brightBlue", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(t.ansi.brightBlue).toBe("#8080ff");
    });

    it("derives accent from ansi.blue", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(t.accent).toBe("#0000ff");
    });

    it("uses the standard dashboard icon literal", () => {
      const t = parseItermColors(ITERM_FIXTURE);
      expect(t.dashboardIcon).toBe("lucide:layout-dashboard");
    });

    it("throws on malformed XML", () => {
      expect(() => parseItermColors("not xml at all")).toThrow();
    });

    it("throws when required Ansi entries are missing", () => {
      const bad = ITERM_FIXTURE.replace(
        /<key>Ansi 4 Color<\/key>[\s\S]*?<\/dict>/,
        "",
      );
      expect(() => parseItermColors(bad)).toThrow(/Ansi 4/);
    });
  });

  describe("parseBase16Yaml", () => {
    it("parses a base16 yaml into a valid ThemeDef", () => {
      const t = parseBase16Yaml(BASE16_FIXTURE);
      expect(() => validateTheme(t)).not.toThrow();
    });

    it("maps base00 to bg/termBg", () => {
      const t = parseBase16Yaml(BASE16_FIXTURE);
      expect(t.bg).toBe("#1d1f21");
      expect(t.termBg).toBe("#1d1f21");
    });

    it("maps base05 to fg/termFg", () => {
      const t = parseBase16Yaml(BASE16_FIXTURE);
      expect(t.fg).toBe("#c5c8c6");
      expect(t.termFg).toBe("#c5c8c6");
    });

    it("maps base08 to ansi.red", () => {
      const t = parseBase16Yaml(BASE16_FIXTURE);
      expect(t.ansi.red).toBe("#cc6666");
    });

    it("maps base0D to ansi.blue", () => {
      const t = parseBase16Yaml(BASE16_FIXTURE);
      expect(t.ansi.blue).toBe("#81a2be");
    });

    it("derives accent from ansi.blue", () => {
      const t = parseBase16Yaml(BASE16_FIXTURE);
      expect(t.accent).toBe("#81a2be");
    });

    it("includes scheme name when provided", () => {
      const t = parseBase16Yaml(BASE16_FIXTURE);
      expect(t.name).toBe("Test Scheme");
    });

    it("accepts unquoted hex values", () => {
      const yaml = BASE16_FIXTURE.replace(/"/g, "");
      const t = parseBase16Yaml(yaml);
      expect(t.bg).toBe("#1d1f21");
    });

    it("uses the standard dashboard icon literal", () => {
      const t = parseBase16Yaml(BASE16_FIXTURE);
      expect(t.dashboardIcon).toBe("lucide:layout-dashboard");
    });

    it("throws when a required base color is missing", () => {
      const bad = BASE16_FIXTURE.replace(/^base08:.*$/m, "");
      expect(() => parseBase16Yaml(bad)).toThrow(/base08/);
    });
  });
});
