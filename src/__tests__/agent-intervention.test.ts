import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const { getAgentByAgentIdMock } = vi.hoisted(() => ({
  getAgentByAgentIdMock: vi.fn(),
}));
vi.mock("../lib/services/agent-detection-service", () => ({
  getAgentByAgentId: getAgentByAgentIdMock,
}));

const { lookupPtyIdMock } = vi.hoisted(() => ({ lookupPtyIdMock: vi.fn() }));
vi.mock("../lib/services/service-helpers", () => ({
  lookupPtyIdForSurface: lookupPtyIdMock,
}));

const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }));
vi.mock("../lib/services/event-bus", () => ({ eventBus: { emit: emitMock } }));

import {
  interruptAgent,
  killAgent,
  sendKeysToAgent,
} from "../lib/services/agent-intervention-service";

const AGENT = {
  agentId: "agent-1",
  agentName: "Claude Code",
  surfaceId: "surf-1",
  workspaceId: "ws-1",
  status: "running",
  createdAt: "2024-01-01T00:00:00.000Z",
  lastStatusChange: "2024-01-01T00:01:00.000Z",
};

beforeEach(() => {
  invokeMock.mockReset();
  getAgentByAgentIdMock.mockReset();
  lookupPtyIdMock.mockReset();
  emitMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("interruptAgent", () => {
  it("returns false when agent not found", async () => {
    getAgentByAgentIdMock.mockReturnValue(undefined);
    expect(await interruptAgent("nope")).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns false when agent has no PTY", async () => {
    getAgentByAgentIdMock.mockReturnValue(AGENT);
    lookupPtyIdMock.mockReturnValue(undefined);
    expect(await interruptAgent("agent-1")).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("sends Ctrl-C to the agent's PTY and returns true", async () => {
    getAgentByAgentIdMock.mockReturnValue(AGENT);
    lookupPtyIdMock.mockReturnValue(42);
    const result = await interruptAgent("agent-1");
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("write_pty", {
      ptyId: 42,
      data: "\x03",
    });
  });

  it("emits agent:interrupted event on success", async () => {
    getAgentByAgentIdMock.mockReturnValue(AGENT);
    lookupPtyIdMock.mockReturnValue(42);
    await interruptAgent("agent-1");
    expect(emitMock).toHaveBeenCalledWith({
      type: "agent:interrupted",
      agentId: "agent-1",
      agentName: "Claude Code",
    });
  });
});

describe("killAgent", () => {
  it("returns false when agent not found", async () => {
    getAgentByAgentIdMock.mockReturnValue(undefined);
    expect(await killAgent("nope")).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns false when agent has no PTY", async () => {
    getAgentByAgentIdMock.mockReturnValue(AGENT);
    lookupPtyIdMock.mockReturnValue(undefined);
    expect(await killAgent("agent-1")).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("kills the agent's PTY and returns true", async () => {
    getAgentByAgentIdMock.mockReturnValue(AGENT);
    lookupPtyIdMock.mockReturnValue(42);
    const result = await killAgent("agent-1");
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("kill_pty", { ptyId: 42 });
  });

  it("emits agent:killed event on success", async () => {
    getAgentByAgentIdMock.mockReturnValue(AGENT);
    lookupPtyIdMock.mockReturnValue(42);
    await killAgent("agent-1");
    expect(emitMock).toHaveBeenCalledWith({
      type: "agent:killed",
      agentId: "agent-1",
      agentName: "Claude Code",
    });
  });
});

describe("sendKeysToAgent", () => {
  it("returns false when agent not found", async () => {
    getAgentByAgentIdMock.mockReturnValue(undefined);
    expect(await sendKeysToAgent("nope", "hello")).toBe(false);
  });

  it("writes keys to the PTY and returns true", async () => {
    getAgentByAgentIdMock.mockReturnValue(AGENT);
    lookupPtyIdMock.mockReturnValue(42);
    const result = await sendKeysToAgent("agent-1", "hello\n");
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("write_pty", {
      ptyId: 42,
      data: "hello\n",
    });
  });
});
