import { describe, it, expect } from "vitest";
import { agenticManifest } from "../manifest";

describe("agenticManifest", () => {
  it("has id agentic", () => {
    expect(agenticManifest.id).toBe("agentic");
  });

  it("has name Agentic", () => {
    expect(agenticManifest.name).toBe("Agentic");
  });

  it("is marked included", () => {
    expect(agenticManifest.included).toBe(true);
  });

  it("has entry ./index.ts", () => {
    expect(agenticManifest.entry).toBe("./index.ts");
  });

  it("contributes is an object", () => {
    expect(typeof agenticManifest.contributes).toBe("object");
    expect(agenticManifest.contributes).not.toBeNull();
  });
});
