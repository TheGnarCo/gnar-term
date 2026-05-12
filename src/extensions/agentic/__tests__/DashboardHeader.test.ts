import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { writable } from "svelte/store";
import type { ExtensionAPI } from "../../api";
import { EXTENSION_API_KEY } from "../../api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Mock the flow modules so we don't exercise their full logic here
vi.mock("../header/bot-task-flow", () => ({
  openBotTaskFlow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../header/preset-library", () => ({
  openPresetLibrary: vi.fn(),
}));

import DashboardHeader from "../header/DashboardHeader.svelte";
import { openBotTaskFlow } from "../header/bot-task-flow";
import { openPresetLibrary } from "../header/preset-library";

function makeFakeApi() {
  const api = {
    agentPresets: writable([]),
    getActiveCwd: vi.fn().mockResolvedValue("/some/path"),
    showFormPrompt: vi.fn().mockResolvedValue(null),
    invoke: vi.fn().mockResolvedValue(undefined),
    createWorkspaceFromDef: vi.fn().mockResolvedValue("ws-id"),
    reportError: vi.fn(),
    runCommand: vi.fn().mockReturnValue(true),
  } as unknown as ExtensionAPI;
  return api;
}

function renderWithApi(api: ExtensionAPI) {
  return render(DashboardHeader, {
    context: new Map([[EXTENSION_API_KEY, api]]),
  });
}

describe("DashboardHeader", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the 'New Bot Task' button", async () => {
    const api = makeFakeApi();
    const { container } = renderWithApi(api);
    await tick();
    const btn = container.querySelector("[data-header-btn='new-bot-task']");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("New Bot Task");
  });

  it("renders the bot icon inside the New Bot Task button", async () => {
    const api = makeFakeApi();
    const { container } = renderWithApi(api);
    await tick();
    const btn = container.querySelector("[data-header-btn='new-bot-task']");
    expect(btn!.querySelector("svg.bot-icon")).not.toBeNull();
  });

  it("no longer renders the legacy '+ New agentic branch' button", async () => {
    const api = makeFakeApi();
    const { container } = renderWithApi(api);
    await tick();
    expect(
      container.querySelector("[data-header-btn='new-branch']"),
    ).toBeNull();
  });

  it("renders the 'AgentPreset library' button", async () => {
    const api = makeFakeApi();
    const { container } = renderWithApi(api);
    await tick();
    const btn = container.querySelector("[data-header-btn='preset-library']");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("AgentPreset library");
  });

  it("clicking new-bot-task invokes openBotTaskFlow with the api", async () => {
    const api = makeFakeApi();
    const { container } = renderWithApi(api);
    await tick();
    const btn = container.querySelector<HTMLElement>(
      "[data-header-btn='new-bot-task']",
    );
    await fireEvent.click(btn!);
    await tick();
    expect(openBotTaskFlow).toHaveBeenCalledWith(api);
  });

  it("clicking preset-library invokes openPresetLibrary with the api", async () => {
    const api = makeFakeApi();
    const { container } = renderWithApi(api);
    await tick();
    const btn = container.querySelector<HTMLElement>(
      "[data-header-btn='preset-library']",
    );
    await fireEvent.click(btn!);
    await tick();
    expect(openPresetLibrary).toHaveBeenCalledWith(api);
  });
});
