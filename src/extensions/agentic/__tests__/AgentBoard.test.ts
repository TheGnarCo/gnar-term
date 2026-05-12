import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup } from "@testing-library/svelte";
import { writable } from "svelte/store";
import type { ExtensionAPI, AgentRef } from "../../api";
import { EXTENSION_API_KEY } from "../../api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import AgentBoard from "../panels/AgentBoard.svelte";

function makeAgent(overrides: Partial<AgentRef> = {}): AgentRef {
  return {
    agentId: "agent-1",
    agentName: "My Agent",
    surfaceId: "surface-1",
    paneId: "pane-1",
    workspaceId: "ws-1",
    status: "running",
    createdAt: new Date().toISOString(),
    lastStatusChange: new Date().toISOString(),
    ...overrides,
  };
}

function makeFakeApi(agents: AgentRef[] = []) {
  const agentsStore = writable<AgentRef[]>(agents);
  const focusSurface = vi.fn();
  const api = {
    agents: agentsStore,
    focusSurface,
  } as unknown as ExtensionAPI;
  return { api, agentsStore, focusSurface };
}

function renderWithApi(api: ExtensionAPI) {
  return render(AgentBoard, {
    context: new Map([[EXTENSION_API_KEY, api]]),
  });
}

describe("AgentBoard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the empty state when no agents", async () => {
    const { api } = makeFakeApi([]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.textContent).toContain("No agents detected yet.");
  });

  it("renders one group per workspaceId when agents differ in workspaceId", async () => {
    const { api } = makeFakeApi([
      makeAgent({ agentId: "a1", workspaceId: "ws-1", surfaceId: "s1" }),
      makeAgent({ agentId: "a2", workspaceId: "ws-2", surfaceId: "s2" }),
    ]);
    const { container } = renderWithApi(api);
    await tick();
    const groups = container.querySelectorAll("[data-workspace-group]");
    expect(groups.length).toBe(2);
  });

  it("clicking a card calls focusSurface with the agent surfaceId", async () => {
    const { api, focusSurface } = makeFakeApi([
      makeAgent({
        agentId: "a1",
        surfaceId: "surface-xyz",
        workspaceId: "ws-1",
      }),
    ]);
    const { container } = renderWithApi(api);
    await tick();
    const card = container.querySelector<HTMLElement>("[data-agent-card]");
    expect(card).not.toBeNull();
    card!.click();
    await tick();
    expect(focusSurface).toHaveBeenCalledWith("surface-xyz");
  });
});
