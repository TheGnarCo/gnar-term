import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { writable } from "svelte/store";
import type { ExtensionAPI, AttentionEventRef } from "../../api";
import { EXTENSION_API_KEY } from "../../api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import AttentionInbox from "../panels/AttentionInbox.svelte";

function makeEvent(
  overrides: Partial<AttentionEventRef> = {},
): AttentionEventRef {
  return {
    paneId: "pane-1",
    surfaceId: "surface-1",
    kind: "awaiting_input",
    source: "agent-state",
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeFakeApi(events: AttentionEventRef[] = []) {
  const attention = writable<AttentionEventRef[]>(events);
  const focusSurface = vi.fn();
  const dismissAttention = vi.fn();
  const api = {
    attention,
    focusSurface,
    dismissAttention,
  } as unknown as ExtensionAPI;
  return { api, attention, focusSurface, dismissAttention };
}

function renderWithApi(api: ExtensionAPI) {
  return render(AttentionInbox, {
    context: new Map([[EXTENSION_API_KEY, api]]),
  });
}

describe("AttentionInbox", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the empty state when attention is empty", async () => {
    const { api } = makeFakeApi([]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.textContent).toContain("Inbox clear.");
  });

  it("rows render in store order (newest-first; store is trusted not re-sorted)", async () => {
    const events = [
      makeEvent({ paneId: "pane-1", title: "First", createdAt: 2000 }),
      makeEvent({ paneId: "pane-2", title: "Second", createdAt: 1000 }),
    ];
    const { api } = makeFakeApi(events);
    const { container } = renderWithApi(api);
    await tick();
    const rows = container.querySelectorAll("[data-attention-row]");
    expect(rows.length).toBe(2);
    // First row should be "First" (store order preserved)
    expect(rows[0].textContent).toContain("First");
    expect(rows[1].textContent).toContain("Second");
  });

  it("row click calls focusSurface then dismissAttention", async () => {
    const event = makeEvent({ paneId: "pane-1", surfaceId: "surface-abc" });
    const { api, focusSurface, dismissAttention } = makeFakeApi([event]);
    const { container } = renderWithApi(api);
    await tick();

    const row = container.querySelector<HTMLElement>("[data-attention-row]");
    expect(row).not.toBeNull();
    await fireEvent.click(row!);
    await tick();

    expect(focusSurface).toHaveBeenCalledWith("surface-abc");
    expect(dismissAttention).toHaveBeenCalledWith("pane-1");
    // focusSurface must be called before dismissAttention
    const focusOrder = focusSurface.mock.invocationCallOrder[0];
    const dismissOrder = dismissAttention.mock.invocationCallOrder[0];
    expect(focusOrder).toBeLessThan(dismissOrder);
  });

  it("row click without surfaceId does NOT call focusSurface but DOES call dismissAttention", async () => {
    const event = makeEvent({ paneId: "pane-1", surfaceId: undefined });
    const { api, focusSurface, dismissAttention } = makeFakeApi([event]);
    const { container } = renderWithApi(api);
    await tick();

    const row = container.querySelector<HTMLElement>("[data-attention-row]");
    expect(row).not.toBeNull();
    await fireEvent.click(row!);
    await tick();

    expect(focusSurface).not.toHaveBeenCalled();
    expect(dismissAttention).toHaveBeenCalledWith("pane-1");
  });
});
