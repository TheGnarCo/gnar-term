/**
 * resolveFilePath — core utility tests
 *
 * Tests the path resolution logic exported from terminal-service.ts.
 * Moved from preview extension tests since this is a core utility.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { invoke } from "@tauri-apps/api/core";
import { resolveFilePath } from "../lib/terminal-service";

const mockInvoke = vi.mocked(invoke);

describe("resolveFilePath", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("absolute paths are returned as-is", async () => {
    expect(await resolveFilePath("/Users/me/report.pdf", "/some/cwd")).toBe(
      "/Users/me/report.pdf",
    );
    expect(mockInvoke).not.toHaveBeenCalledWith("get_home");
  });

  it("tilde paths are expanded using get_home", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") return "/Users/testuser";
      return undefined;
    });

    expect(await resolveFilePath("~/Downloads/report.pdf", "/some/cwd")).toBe(
      "/Users/testuser/Downloads/report.pdf",
    );
    expect(mockInvoke).toHaveBeenCalledWith("get_home");
  });

  it("tilde paths fall back to raw path if get_home fails", async () => {
    mockInvoke.mockRejectedValue(new Error("HOME not set"));

    expect(await resolveFilePath("~/Downloads/report.pdf", "/some/cwd")).toBe(
      "~/Downloads/report.pdf",
    );
  });

  it("relative paths are prepended with cwd", async () => {
    expect(await resolveFilePath("report.pdf", "/Users/me/project")).toBe(
      "/Users/me/project/report.pdf",
    );
  });

  it("relative paths with ./ prefix are prepended with cwd", async () => {
    expect(
      await resolveFilePath("./docs/report.pdf", "/Users/me/project"),
    ).toBe("/Users/me/project/./docs/report.pdf");
  });

  it("cwd trailing slash does not produce double slash", async () => {
    expect(await resolveFilePath("report.pdf", "/Users/me/")).toBe(
      "/Users/me/report.pdf",
    );
    expect(await resolveFilePath("report.pdf", "/")).toBe("/report.pdf");
  });

  it("relative paths without cwd are returned as-is", async () => {
    expect(await resolveFilePath("report.pdf", undefined)).toBe("report.pdf");
  });

  it("tilde path with only ~ and slash", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") return "/Users/testuser";
      return undefined;
    });

    expect(await resolveFilePath("~/report.pdf", undefined)).toBe(
      "/Users/testuser/report.pdf",
    );
  });
});
