import { describe, it, expect } from "vitest";
import { migrateAgentsConfig, type AgentPreset } from "../lib/agents-config";
import { migrateLoadedConfig } from "../lib/config";

// ---------------------------------------------------------------------------
// migrateAgentsConfig unit tests
// ---------------------------------------------------------------------------

describe("migrateAgentsConfig", () => {
  it("returns empty shape for null / undefined / non-object input", () => {
    expect(migrateAgentsConfig(null)).toEqual({ otherFields: {} });
    expect(migrateAgentsConfig(undefined)).toEqual({ otherFields: {} });
    expect(migrateAgentsConfig("string")).toEqual({ otherFields: {} });
    expect(migrateAgentsConfig([])).toEqual({ otherFields: {} });
  });

  it("old-shape: moves agents{knownAgents} to agentDetection; agents is undefined", () => {
    const raw = {
      theme: "dark",
      agents: {
        knownAgents: [{ name: "claude-code", titlePatterns: ["claude"] }],
        idleTimeout: 45,
      },
    };
    const result = migrateAgentsConfig(raw);
    expect(result.agentDetection).toEqual(raw.agents);
    expect(result.agents).toBeUndefined();
    expect(result.otherFields).toEqual({ theme: "dark" });
  });

  it("old-shape: moves agents{idleTimeout only} to agentDetection", () => {
    const raw = { agents: { idleTimeout: 60 } };
    const result = migrateAgentsConfig(raw);
    expect(result.agentDetection).toEqual({ idleTimeout: 60 });
    expect(result.agents).toBeUndefined();
  });

  it("new-shape: keeps preset array under agents; agentDetection is undefined", () => {
    const presets: AgentPreset[] = [
      { name: "Claude Code", command: "claude" },
      { name: "Aider", command: "aider", autoSpawn: false },
    ];
    const raw = { agents: presets, theme: "light" };
    const result = migrateAgentsConfig(raw);
    expect(result.agents).toEqual(presets);
    expect(result.agentDetection).toBeUndefined();
    expect(result.otherFields).toEqual({ theme: "light" });
  });

  it("new-shape: empty array is a valid preset list", () => {
    const raw = { agents: [] };
    const result = migrateAgentsConfig(raw);
    expect(result.agents).toEqual([]);
    expect(result.agentDetection).toBeUndefined();
  });

  it("both fields present: preserves both", () => {
    const detection = {
      knownAgents: [{ name: "aider", titlePatterns: ["aider"] }],
    };
    const presets: AgentPreset[] = [{ name: "Aider", command: "aider" }];
    const raw = { agentDetection: detection, agents: presets };
    const result = migrateAgentsConfig(raw);
    expect(result.agentDetection).toEqual(detection);
    expect(result.agents).toEqual(presets);
  });

  it("neither field present: both are undefined", () => {
    const raw = { theme: "dark", fontSize: 14 };
    const result = migrateAgentsConfig(raw);
    expect(result.agentDetection).toBeUndefined();
    expect(result.agents).toBeUndefined();
    expect(result.otherFields).toEqual({ theme: "dark", fontSize: 14 });
  });

  it("is idempotent: applying twice produces the same result", () => {
    const raw = {
      agents: {
        knownAgents: [{ name: "claude-code", titlePatterns: ["claude"] }],
      },
      fontSize: 14,
    };
    const once = migrateAgentsConfig(raw);
    // Simulate second pass: build a plain object from first result
    const secondInput = {
      ...once.otherFields,
      ...(once.agentDetection !== undefined
        ? { agentDetection: once.agentDetection }
        : {}),
      ...(once.agents !== undefined ? { agents: once.agents } : {}),
    };
    const twice = migrateAgentsConfig(secondInput);
    expect(twice.agentDetection).toEqual(once.agentDetection);
    expect(twice.agents).toEqual(once.agents);
    expect(twice.otherFields).toEqual(once.otherFields);
  });
});

// ---------------------------------------------------------------------------
// migrateLoadedConfig integration (verifies wiring in config.ts)
// ---------------------------------------------------------------------------

describe("migrateLoadedConfig — agents migration", () => {
  it("old-shape raw JSON: agents detection moves to agentDetection", () => {
    const raw = {
      theme: "dark",
      agents: {
        knownAgents: [{ name: "claude-code", titlePatterns: ["claude"] }],
        idleTimeout: 30,
      },
    };
    const cfg = migrateLoadedConfig(raw);
    expect(cfg.agentDetection).toEqual(raw.agents);
    expect(cfg.agents).toBeUndefined();
    expect((cfg as Record<string, unknown>).theme).toBe("dark");
  });

  it("new-shape raw JSON: preset array stays under agents", () => {
    const presets: AgentPreset[] = [
      { name: "Claude Code", command: "claude", autoSpawn: true },
    ];
    const raw = { agents: presets };
    const cfg = migrateLoadedConfig(raw);
    expect(cfg.agents).toEqual(presets);
    expect(cfg.agentDetection).toBeUndefined();
  });

  it("round-trip: unknown top-level keys are preserved", () => {
    const raw = {
      unknownFutureField: "preserve-me",
      anotherUnknown: 42,
      agents: { knownAgents: [], idleTimeout: 10 },
    };
    const cfg = migrateLoadedConfig(raw) as Record<string, unknown>;
    expect(cfg.unknownFutureField).toBe("preserve-me");
    expect(cfg.anotherUnknown).toBe(42);
    // Migration applied
    expect(cfg.agentDetection).toEqual({ knownAgents: [], idleTimeout: 10 });
    expect(cfg.agents).toBeUndefined();
  });

  it("round-trip: both agentDetection and agents preserved when both present", () => {
    const detection = { knownAgents: [], idleTimeout: 20 };
    const presets: AgentPreset[] = [{ name: "Aider", command: "aider" }];
    const raw = { agentDetection: detection, agents: presets };
    const cfg = migrateLoadedConfig(raw);
    expect(cfg.agentDetection).toEqual(detection);
    expect(cfg.agents).toEqual(presets);
  });
});
