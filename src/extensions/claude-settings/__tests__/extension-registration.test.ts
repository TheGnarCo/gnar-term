import { describe, it, expect } from "vitest";
import { claudeSettingsManifest } from "../index";
import { INCLUDED_EXTENSIONS } from "../../../lib/bootstrap/register-included-extensions";

describe("claude-settings extension", () => {
  it("manifest has required fields", () => {
    expect(claudeSettingsManifest.id).toBe("claude-settings");
    expect(claudeSettingsManifest.name).toBe("Claude Settings");
    expect(claudeSettingsManifest.included).toBe(true);
    expect(claudeSettingsManifest.version).toBeTruthy();
  });

  it("is registered in INCLUDED_EXTENSIONS", () => {
    const ids = INCLUDED_EXTENSIONS.map(([m]) => m.id);
    expect(ids).toContain("claude-settings");
  });
});
