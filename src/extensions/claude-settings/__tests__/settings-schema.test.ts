import { describe, it, expect } from "vitest";
import { SETTINGS_SECTIONS, OWNED_KEYS } from "../lib/settings-schema";

describe("settings-schema", () => {
  it("all sections have at least one field", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.fields.length).toBeGreaterThan(0);
    }
  });

  it("all field types are valid", () => {
    const validTypes = new Set([
      "string",
      "enum",
      "boolean",
      "string-list",
      "kv-map",
      "hooks",
      "permissions",
      "plugins",
      "dir-listing",
    ]);
    for (const section of SETTINGS_SECTIONS) {
      for (const field of section.fields) {
        expect(
          validTypes.has(field.type),
          `${section.id}.${field.key} has invalid type: ${field.type}`,
        ).toBe(true);
      }
    }
  });

  it("enum fields have at least 2 options", () => {
    for (const section of SETTINGS_SECTIONS) {
      for (const field of section.fields) {
        if (field.type === "enum") {
          expect(
            (field.options ?? []).length,
            `${section.id}.${field.key} enum needs options`,
          ).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("OWNED_KEYS contains all ownsKeys from all sections", () => {
    for (const section of SETTINGS_SECTIONS) {
      for (const key of section.ownsKeys) {
        expect(OWNED_KEYS.has(key), `${key} should be in OWNED_KEYS`).toBe(
          true,
        );
      }
    }
  });

  it("key sections have unique ids", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
