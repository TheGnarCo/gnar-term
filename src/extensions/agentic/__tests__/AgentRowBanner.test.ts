import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { writable } from "svelte/store";
import type { ExtensionAPI, AgentRef } from "../../api";
import { EXTENSION_API_KEY } from "../../api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import AgentRowBanner from "../contributions/AgentRowBanner.svelte";

function makeAgent(overrides: Partial<AgentRef> = {}): AgentRef {
  return {
    agentId: "agent-1",
    agentName: "Test Agent",
    surfaceId: "surface-xyz",
    paneId: "pane-a",
    workspaceId: "ws-a",
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
  return { api, focusSurface };
}

function renderWith(api: ExtensionAPI, id: string) {
  return render(AgentRowBanner, {
    context: new Map([[EXTENSION_API_KEY, api]]),
    props: { id },
  });
}

describe("AgentRowBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when no agent matches the id", async () => {
    const { api } = makeFakeApi([]);
    const { container } = renderWith(api, "missing");
    await tick();
    expect(container.querySelector("[data-agent-row]")).toBeNull();
  });

  it("renders the agent name and status when found", async () => {
    const { api } = makeFakeApi([makeAgent({ agentName: "Claude" })]);
    const { container } = renderWith(api, "agent-1");
    await tick();
    const row = container.querySelector("[data-agent-row]");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Claude");
    expect(row!.textContent).toContain("running");
  });

  it("focuses the agent surface on click", async () => {
    const { api, focusSurface } = makeFakeApi([
      makeAgent({ surfaceId: "surface-xyz" }),
    ]);
    const { container } = renderWith(api, "agent-1");
    await tick();
    const row = container.querySelector(
      "[data-agent-row]",
    ) as HTMLElement | null;
    expect(row).not.toBeNull();
    await fireEvent.click(row!);
    expect(focusSurface).toHaveBeenCalledWith("surface-xyz");
  });
});
