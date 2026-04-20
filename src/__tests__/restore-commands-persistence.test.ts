/**
 * Tier 3 session restore — serialization tests.
 *
 * `serializeLayout()` must round-trip `definedCommand` as `command` so the
 * pending-restore prompt survives across launches.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { serializeLayout } from "../lib/services/workspace-service";
import type { TerminalSurface } from "../lib/types";

function makeSurface(
  overrides: Partial<TerminalSurface> = {},
): TerminalSurface {
  return {
    kind: "terminal",
    id: "s1",
    terminal: {} as unknown as TerminalSurface["terminal"],
    fitAddon: {} as unknown as TerminalSurface["fitAddon"],
    searchAddon: {} as unknown as TerminalSurface["searchAddon"],
    termElement: document.createElement("div"),
    ptyId: 1,
    title: "shell",
    cwd: "/tmp",
    hasUnread: false,
    opened: true,
    ...overrides,
  };
}

describe("serializeLayout — definedCommand round-trip", () => {
  it("includes `command` when definedCommand is set", () => {
    const surface = makeSurface({ definedCommand: "npm run dev" });
    const layout = serializeLayout({
      type: "pane",
      pane: {
        id: "p1",
        surfaces: [surface],
        activeSurfaceId: surface.id,
      },
    });
    expect(layout).toEqual({
      pane: {
        surfaces: [
          {
            type: "terminal",
            name: "shell",
            cwd: "/tmp",
            command: "npm run dev",
            focus: true,
          },
        ],
      },
    });
  });

  it("omits `command` when definedCommand is undefined", () => {
    const surface = makeSurface();
    const layout = serializeLayout({
      type: "pane",
      pane: {
        id: "p1",
        surfaces: [surface],
        activeSurfaceId: surface.id,
      },
    });
    expect(layout).toEqual({
      pane: {
        surfaces: [
          {
            type: "terminal",
            name: "shell",
            cwd: "/tmp",
            focus: true,
          },
        ],
      },
    });
    const surfaceDef = (layout as { pane: { surfaces: unknown[] } }).pane
      .surfaces[0] as Record<string, unknown>;
    expect("command" in surfaceDef).toBe(false);
  });

  it("does NOT include `pendingRestoreCommand` in the serialized form", () => {
    const surface = makeSurface({
      definedCommand: "echo hi",
      pendingRestoreCommand: true,
    });
    const layout = serializeLayout({
      type: "pane",
      pane: {
        id: "p1",
        surfaces: [surface],
        activeSurfaceId: surface.id,
      },
    });
    const surfaceDef = (layout as { pane: { surfaces: unknown[] } }).pane
      .surfaces[0] as Record<string, unknown>;
    expect("pendingRestoreCommand" in surfaceDef).toBe(false);
    expect(surfaceDef.command).toBe("echo hi");
  });
});
