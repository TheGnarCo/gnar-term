import { describe, it, expect } from "vitest";
import { spacebaseManifest } from "../index";
import { INCLUDED_EXTENSIONS } from "../../../lib/bootstrap/register-included-extensions";

describe("spacebase extension manifest", () => {
  it("has required identity fields", () => {
    expect(spacebaseManifest.id).toBe("spacebase");
    expect(spacebaseManifest.name).toBe("Spacebase");
    expect(spacebaseManifest.included).toBe(true);
    expect(spacebaseManifest.version).toBeTruthy();
  });

  it("declares filesystem permission for cache writes", () => {
    expect(spacebaseManifest.permissions).toContain("filesystem");
  });

  it("declares the expected settings fields", () => {
    const fields = spacebaseManifest.contributes?.settings?.fields ?? {};
    expect(Object.keys(fields).sort()).toEqual(
      ["apiKey", "baseUrl", "projectId", "showTitleBarIcon", "syncDir"].sort(),
    );
  });

  it("apiKey field is a string with a description that warns about secrets", () => {
    const apiKey = spacebaseManifest.contributes?.settings?.fields?.apiKey;
    expect(apiKey?.type).toBe("string");
    // The settings UI has no password/secret field type, so the description
    // is the only place to flag that this value is sensitive.
    expect(apiKey?.description?.toLowerCase()).toMatch(/secret|sensitive|key/);
  });

  it("baseUrl field defaults to the production spacebase URL", () => {
    const baseUrl = spacebaseManifest.contributes?.settings?.fields?.baseUrl;
    expect(baseUrl?.type).toBe("string");
    expect(baseUrl?.default).toBe("https://spacebase.thegnar.com");
  });

  it("showTitleBarIcon is a boolean defaulting to true", () => {
    const f = spacebaseManifest.contributes?.settings?.fields?.showTitleBarIcon;
    expect(f?.type).toBe("boolean");
    expect(f?.default).toBe(true);
  });

  it("is registered in INCLUDED_EXTENSIONS", () => {
    const ids = INCLUDED_EXTENSIONS.map(([m]) => m.id);
    expect(ids).toContain("spacebase");
  });
});
