/**
 * Tests for applyRepoDef — the helper that checks for .gnar-term/workspace.json
 * in a repo path and merges its contents into the default NestedWorkspaceDef.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mockIPC,
  mockWindows,
  clearMocks,
  mockConvertFileSrc,
} from "@tauri-apps/api/mocks";
import { randomFillSync } from "crypto";
import type { NestedWorkspaceDef } from "../lib/config";

// jsdom doesn't provide WebCrypto — polyfill for mockIPC
beforeEach(() => {
  Object.defineProperty(window, "crypto", {
    value: { getRandomValues: (buf: Uint8Array) => randomFillSync(buf) },
    writable: true,
  });
  mockWindows("main");
  mockConvertFileSrc("macos");
});

afterEach(() => {
  clearMocks();
  vi.resetModules();
});

describe("applyRepoDef", () => {
  it("merges repo def fields into the default def when bootstrap file exists", async () => {
    const repoDef: Partial<NestedWorkspaceDef> = {
      name: "My Project Branch",
      layout: {
        direction: "horizontal",
        split: 0.5,
        children: [
          { pane: { surfaces: [{ type: "terminal" }] } },
          {
            pane: {
              surfaces: [{ type: "browser", url: "http://localhost:3000" }],
            },
          },
        ],
      },
    };

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown>;
      if (cmd === "file_exists") return true;
      if (cmd === "read_file") {
        expect(a.path).toContain("/.gnar-term/workspace.json");
        return JSON.stringify(repoDef);
      }
      return undefined;
    });

    const { applyRepoDef } = await import("../lib/bootstrap/init-workspaces");

    const defaultDef: NestedWorkspaceDef = {
      name: "Default Branch 1",
      cwd: "/some/repo",
      metadata: { parentWorkspaceId: "ws-123" },
      layout: { pane: { surfaces: [{ type: "terminal" }] } },
    };

    const result = await applyRepoDef(defaultDef, "/some/repo");

    // Fields from repoDef override defaults
    expect(result.name).toBe("My Project Branch");
    expect(result.layout).toEqual(repoDef.layout);

    // Fields not in repoDef are preserved from defaultDef
    expect(result.cwd).toBe("/some/repo");
    expect(result.metadata).toEqual({ parentWorkspaceId: "ws-123" });
  });

  it("returns the default def unchanged when bootstrap file does not exist", async () => {
    mockIPC((cmd) => {
      if (cmd === "file_exists") return false;
      return undefined;
    });

    const { applyRepoDef } = await import("../lib/bootstrap/init-workspaces");

    const defaultDef: NestedWorkspaceDef = {
      name: "Default Branch 1",
      cwd: "/some/repo",
      metadata: { parentWorkspaceId: "ws-123" },
      layout: { pane: { surfaces: [{ type: "terminal" }] } },
    };

    const result = await applyRepoDef(defaultDef, "/some/repo");

    expect(result).toEqual(defaultDef);
  });

  it("falls back to defaults and warns when workspace.json contains invalid JSON", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockIPC((cmd) => {
      if (cmd === "file_exists") return true;
      if (cmd === "read_file") return "{ this is: not valid json }";
      return undefined;
    });

    const { applyRepoDef } = await import("../lib/bootstrap/init-workspaces");

    const defaultDef: NestedWorkspaceDef = {
      name: "Default Branch 1",
      cwd: "/some/repo",
      metadata: { parentWorkspaceId: "ws-123" },
      layout: { pane: { surfaces: [{ type: "terminal" }] } },
    };

    const result = await applyRepoDef(defaultDef, "/some/repo");

    expect(result).toEqual(defaultDef);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[bootstrap]"),
    );

    warnSpy.mockRestore();
  });
});
