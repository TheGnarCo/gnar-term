/**
 * DiffSurface layout regression — the outer container must participate in
 * the pane's flex column (flex: 1 + min-height: 0) and hide itself when
 * inactive. Earlier the surface used height: 100% with no flex hint and
 * no visibility gate, which collapsed the body to zero height inside a
 * flex column pane — the "Uncommitted Changes" tab appeared fully blank.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/svelte";
import { writable } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import DiffSurface from "../DiffSurface.svelte";
import ExtensionWrapper from "../../../lib/components/ExtensionWrapper.svelte";

function makeApi(
  invokeImpl: (cmd: string, args?: unknown) => Promise<unknown>,
) {
  const theme = writable({
    bg: "#000",
    fg: "#fff",
    fgDim: "#888",
    border: "#333",
    accent: "#6bf",
  });
  return {
    invoke: invokeImpl as unknown as <T = unknown>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>,
    getActiveCwd: () => Promise.resolve("/work/repo"),
    theme,
  } as never;
}

describe("DiffSurface layout", () => {
  beforeEach(() => cleanup());

  it("outer .diff-surface renders as block when visible so the pane flex column gives it height", async () => {
    const api = makeApi(() => Promise.resolve(""));
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: DiffSurface,
        props: { repoPath: "/work/repo" },
      },
    });
    await waitFor(() => {
      expect(container.querySelector(".diff-surface")).not.toBeNull();
    });
    const surface = container.querySelector(".diff-surface") as HTMLElement;
    // The visible-driven display is the observable half of the fix that
    // jsdom can verify; the flex: 1 + min-height: 0 half lives in the
    // component's <style> block so pane-column sizing works in the real
    // webview. (jsdom does not resolve scoped Svelte CSS.)
    expect(surface.style.display).toBe("block");
  });

  it("hides the container when visible=false so inactive surfaces don't cover the pane", async () => {
    const api = makeApi(() => Promise.resolve(""));
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: DiffSurface,
        props: { repoPath: "/work/repo", visible: false },
      },
    });
    await waitFor(() => {
      expect(container.querySelector(".diff-surface")).not.toBeNull();
    });
    const surface = container.querySelector(".diff-surface") as HTMLElement;
    expect(surface.style.display).toBe("none");
  });
});
