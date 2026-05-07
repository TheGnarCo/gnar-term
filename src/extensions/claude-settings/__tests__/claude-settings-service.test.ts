import { describe, it, expect } from "vitest";
import {
  parseClaudeSettings,
  serializeClaudeSettings,
} from "../lib/claude-settings-service";

describe("parseClaudeSettings", () => {
  it("parses valid JSON", () => {
    const result = parseClaudeSettings(
      '{"model": "sonnet", "env": {"KEY": "val"}}',
    );
    expect(result).toEqual({ model: "sonnet", env: { KEY: "val" } });
  });

  it("returns empty object for invalid JSON", () => {
    expect(parseClaudeSettings("not json")).toEqual({});
    expect(parseClaudeSettings("")).toEqual({});
    expect(parseClaudeSettings("{broken")).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(parseClaudeSettings("")).toEqual({});
  });
});

describe("serializeClaudeSettings", () => {
  it("serializes to pretty-printed JSON", () => {
    const result = serializeClaudeSettings({ model: "haiku" });
    expect(result).toBe('{\n  "model": "haiku"\n}');
  });

  it("round-trips arbitrary settings", () => {
    const original = {
      model: "sonnet",
      permissions: { allow: ["Bash(npm *)"], deny: [] },
      env: { KEY: "val" },
    };
    const serialized = serializeClaudeSettings(original);
    expect(parseClaudeSettings(serialized)).toEqual(original);
  });
});
