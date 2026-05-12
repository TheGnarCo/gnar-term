import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup } from "@testing-library/svelte";
import { writable } from "svelte/store";
import type { ExtensionAPI, BranchLifecycleEntry } from "../../api";
import { EXTENSION_API_KEY } from "../../api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import BranchLifecycleSwimlanes from "../panels/BranchLifecycleSwimlanes.svelte";

function makeEntry(
  lifecycle: BranchLifecycleEntry["lifecycle"],
  prStateKnown = true,
  reason?: string,
): BranchLifecycleEntry {
  return {
    lifecycle,
    prStateKnown,
    lastActivityAt: Date.now(),
    reason,
  };
}

function makeFakeApi(entries: [string, BranchLifecycleEntry][] = []) {
  const branchLifecycle = writable<Map<string, BranchLifecycleEntry>>(
    new Map(entries),
  );
  const api = { branchLifecycle } as unknown as ExtensionAPI;
  return { api, branchLifecycle };
}

function renderWithApi(api: ExtensionAPI) {
  return render(BranchLifecycleSwimlanes, {
    context: new Map([[EXTENSION_API_KEY, api]]),
  });
}

describe("BranchLifecycleSwimlanes", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the empty state when map is empty", async () => {
    const { api } = makeFakeApi([]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.textContent).toContain("No branches tracked yet.");
  });

  it("renders an entry in the matching column", async () => {
    const { api } = makeFakeApi([["feat/my-branch", makeEntry("active")]]);
    const { container } = renderWithApi(api);
    await tick();
    const column = container.querySelector('[data-lifecycle-column="active"]');
    expect(column).not.toBeNull();
    expect(column!.textContent).toContain("feat/my-branch");
  });

  it("does not render abandoned entries", async () => {
    const { api } = makeFakeApi([
      ["feat/old", makeEntry("abandoned" as BranchLifecycleEntry["lifecycle"])],
    ]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.textContent).not.toContain("feat/old");
  });

  it("shows the hint banner when at least one entry has prStateKnown=false", async () => {
    const { api } = makeFakeApi([
      ["feat/a", makeEntry("active", true)],
      ["feat/b", makeEntry("draft", false)],
    ]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.querySelector("[data-pr-hint]")).not.toBeNull();
  });

  it("does not show the hint banner when all entries have prStateKnown=true", async () => {
    const { api } = makeFakeApi([
      ["feat/a", makeEntry("active", true)],
      ["feat/b", makeEntry("draft", true)],
    ]);
    const { container } = renderWithApi(api);
    await tick();
    expect(container.querySelector("[data-pr-hint]")).toBeNull();
  });
});
