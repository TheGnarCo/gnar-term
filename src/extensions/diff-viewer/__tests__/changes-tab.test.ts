/**
 * Changes Tab + Auto-Open — Story 3c
 *
 * Tests the Changes sidebar tab manifest in diff-viewer extension
 * and the programmatic tab activation store.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import { render, waitFor, cleanup } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { diffViewerManifest } from "../index";
import ChangesTab from "../ChangesTab.svelte";
import ExtensionWrapper from "../../../lib/components/ExtensionWrapper.svelte";
import {
  activeSidebarTabStore,
  activateSidebarTab,
  resetSidebarTabs,
} from "../../../lib/services/sidebar-tab-registry";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

describe("Changes Tab manifest", () => {
  const tabs = diffViewerManifest.contributes?.secondarySidebarTabs;

  it("declares a changes sidebar tab", () => {
    expect(tabs).toBeDefined();
    const changesTab = tabs!.find((t) => t.id === "changes");
    expect(changesTab).toBeDefined();
    expect(changesTab!.label).toBe("Changes");
  });

  it("subscribes to worktree:merged event", () => {
    const events = diffViewerManifest.contributes?.events;
    expect(events).toContain("worktree:merged");
  });
});

describe("Programmatic tab activation", () => {
  beforeEach(() => {
    resetSidebarTabs();
  });

  it("activeSidebarTabStore starts null", () => {
    expect(get(activeSidebarTabStore)).toBeNull();
  });

  it("activateSidebarTab sets the store value", () => {
    activateSidebarTab("diff-viewer:changes");
    expect(get(activeSidebarTabStore)).toBe("diff-viewer:changes");
  });
});

describe("ChangesTab file-status rendering", () => {
  beforeEach(() => {
    cleanup();
  });

  function makeApi(files: unknown) {
    const invoke = vi.fn().mockResolvedValue(files);
    const theme = writable({
      bg: "#000",
      fg: "#fff",
      fgDim: "#888",
      border: "#333",
      accent: "#6bf",
    });
    return {
      api: {
        invoke,
        getActiveCwd: () => Promise.resolve("/work/repo"),
        theme,
        state: {
          get: <T>() => undefined as T | undefined,
          set: () => {},
        },
        on: () => {},
        off: () => {},
      } as never,
      invoke,
    };
  }

  it("renders porcelain status chars (M, ?, A) directly — not English words", async () => {
    const { api } = makeApi([
      { path: "src/changed.ts", status: "M", staged: " " },
      { path: "src/new.ts", status: "?", staged: "?" },
      { path: "src/added.ts", status: " ", staged: "A" },
    ]);

    const { container } = render(ExtensionWrapper, {
      props: { api, component: ChangesTab, props: {} },
    });

    await waitFor(() => {
      expect(container.textContent).toMatch(/src\/changed\.ts/);
    });

    // Each file row must render its porcelain status char, not "?" fallback.
    // Falls back to staged column when unstaged is blank (the added.ts case).
    const rows = container.querySelectorAll(".list-item");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("M");
    expect(rows[1].textContent).toContain("?");
    expect(rows[2].textContent).toContain("A");
  });

  it("colors each status char with its category color — not the muted fallback", async () => {
    const { api } = makeApi([
      { path: "m.ts", status: "M", staged: " " },
      { path: "a.ts", status: "A", staged: " " },
    ]);

    const { container } = render(ExtensionWrapper, {
      props: { api, component: ChangesTab, props: {} },
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".list-item")).toHaveLength(2);
    });

    const rows = container.querySelectorAll(".list-item");
    // Modified → amber; Added → green. If the lookup were still keyed on
    // English words the icon span would fall back to $theme.fgDim (#888).
    const mColor = (rows[0].querySelector("span") as HTMLElement).style.color;
    const aColor = (rows[1].querySelector("span") as HTMLElement).style.color;
    expect(mColor).toMatch(/rgb\(232, 183, 58\)|#e8b73a/i);
    expect(aColor).toMatch(/rgb\(78, 201, 87\)|#4ec957/i);
  });
});
