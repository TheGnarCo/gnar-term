/**
 * DiffSurface "Uncommitted Changes" regression — when the surface is
 * opened with just a repoPath (the dirty-pill default), it must:
 *
 *   1. Invoke git_diff with base=HEAD so staged changes appear. Plain
 *      `git diff` shows unstaged only, so a tree whose changes are all
 *      staged rendered as "No changes" despite the sidebar claiming
 *      "N modified".
 *   2. Fold untracked files in as synthetic "new file" diffs (via
 *      git_status + read_file) because `git diff HEAD` has no pre-image
 *      for untracked paths and would omit them entirely.
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
    invoke: vi.fn(invokeImpl) as unknown as <T = unknown>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>,
    getActiveCwd: () => Promise.resolve("/work/repo"),
    theme,
  } as never;
}

describe("DiffSurface uncommitted defaults", () => {
  beforeEach(() => cleanup());

  it("passes base=HEAD to git_diff when only repoPath is given", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const api = makeApi(async (cmd, args) => {
      calls.push({ cmd, args: args as Record<string, unknown> });
      if (cmd === "git_diff") return "";
      if (cmd === "git_status") return [];
      return "";
    });

    render(ExtensionWrapper, {
      props: {
        api,
        component: DiffSurface,
        props: { repoPath: "/work/repo" },
      },
    });

    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "git_diff")).toBe(true);
    });
    const diffCall = calls.find((c) => c.cmd === "git_diff")!;
    expect(diffCall.args).toMatchObject({
      repoPath: "/work/repo",
      base: "HEAD",
    });
  });

  it("does NOT force base=HEAD when the caller already specified staged/base/compare/filePath", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const api = makeApi(async (cmd, args) => {
      calls.push({ cmd, args: args as Record<string, unknown> });
      if (cmd === "git_diff") return "";
      return [];
    });

    render(ExtensionWrapper, {
      props: {
        api,
        component: DiffSurface,
        props: { repoPath: "/work/repo", staged: true },
      },
    });

    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "git_diff")).toBe(true);
    });
    const diffCall = calls.find((c) => c.cmd === "git_diff")!;
    expect(diffCall.args).toMatchObject({
      repoPath: "/work/repo",
      staged: true,
    });
    expect(diffCall.args?.base).toBeUndefined();
  });

  it("folds untracked files in as synthetic new-file diffs so they render", async () => {
    const api = makeApi(async (cmd, args) => {
      if (cmd === "git_diff") return "";
      if (cmd === "git_status") {
        return [
          { path: "notes.md", status: "?", staged: "?" },
          { path: "scratch.log", status: "?", staged: "?" },
        ];
      }
      if (cmd === "read_file") {
        const path = (args as { path: string }).path;
        if (path.endsWith("notes.md")) return "hello\nworld\n";
        if (path.endsWith("scratch.log")) return "line1\n";
        return "";
      }
      return "";
    });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: DiffSurface,
        props: { repoPath: "/work/repo" },
      },
    });

    await waitFor(() => {
      expect(container.textContent).toMatch(/notes\.md/);
    });
    expect(container.textContent).toMatch(/scratch\.log/);
    // Content from the untracked files should appear in the body.
    expect(container.textContent).toMatch(/hello/);
    expect(container.textContent).toMatch(/line1/);
  });
});
