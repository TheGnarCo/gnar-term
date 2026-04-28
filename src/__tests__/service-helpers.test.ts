/**
 * Tests for service-helpers — getHome, safeFocus, getActiveCwd
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { writable } from "svelte/store";
import type { Surface } from "../lib/types";

// Mock dependencies before importing the module under test
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("svelte", () => ({
  tick: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/stores/workspace", () => ({
  activeSurface: writable(null),
  workspaces: writable([]),
}));

vi.mock("../lib/types", () => ({
  isTerminalSurface: vi.fn((s) => s?.kind === "terminal"),
  getAllPanes: vi.fn(() => []),
}));

import { invoke } from "@tauri-apps/api/core";
import { tick } from "svelte";
import { activeSurface, workspaces } from "../lib/stores/workspace";

const mockedInvoke = vi.mocked(invoke);
const mockedTick = vi.mocked(tick);

describe("getHome", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function loadModule() {
    const mod = await import("../lib/services/service-helpers");
    const { invoke: freshInvoke } = await import("@tauri-apps/api/core");
    return { mod, invoke: vi.mocked(freshInvoke) };
  }

  it("returns home directory from invoke", async () => {
    const { mod, invoke: inv } = await loadModule();
    inv.mockResolvedValueOnce("/home/user" as never);

    const result = await mod.getHome();
    expect(result).toBe("/home/user");
    expect(inv).toHaveBeenCalledWith("get_home");
  });

  it("caches the result on subsequent calls", async () => {
    const { mod, invoke: inv } = await loadModule();
    inv.mockResolvedValueOnce("/home/user" as never);

    await mod.getHome();
    const result = await mod.getHome();

    expect(result).toBe("/home/user");
    expect(inv).toHaveBeenCalledTimes(1);
  });

  it("falls back to /tmp on invoke failure", async () => {
    const { mod, invoke: inv } = await loadModule();
    inv.mockRejectedValueOnce(new Error("not available") as never);

    const result = await mod.getHome();
    expect(result).toBe("/tmp");
  });
});

describe("safeFocus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing for null surface", async () => {
    const { safeFocus } = await import("../lib/services/service-helpers");
    await safeFocus(null);
    expect(mockedTick).not.toHaveBeenCalled();
  });

  it("does nothing for undefined surface", async () => {
    const { safeFocus } = await import("../lib/services/service-helpers");
    await safeFocus(undefined);
    expect(mockedTick).not.toHaveBeenCalled();
  });

  it("does nothing for non-terminal surface", async () => {
    const { safeFocus } = await import("../lib/services/service-helpers");
    const extensionSurface = {
      kind: "extension",
      id: "ext-1",
    } as unknown as Surface;
    await safeFocus(extensionSurface);
    expect(mockedTick).not.toHaveBeenCalled();
  });

  it("calls tick then terminal.focus for terminal surface", async () => {
    const { safeFocus } = await import("../lib/services/service-helpers");
    const focus = vi.fn();
    const termSurface = {
      kind: "terminal",
      id: "t1",
      terminal: { focus },
    } as unknown as Surface;

    await safeFocus(termSurface);
    expect(mockedTick).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });
});

describe("getActiveCwd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeSurface.set(null);
  });

  it("returns undefined when no active surface", async () => {
    const { getActiveCwd } = await import("../lib/services/service-helpers");
    const result = await getActiveCwd();
    expect(result).toBeUndefined();
  });

  it("returns undefined for non-terminal surface", async () => {
    activeSurface.set({ kind: "extension", id: "ext-1" } as unknown as Surface);
    const { getActiveCwd } = await import("../lib/services/service-helpers");
    const result = await getActiveCwd();
    expect(result).toBeUndefined();
  });

  it("returns cwd directly when surface has cwd set", async () => {
    activeSurface.set({
      kind: "terminal",
      id: "t1",
      cwd: "/home/user/project",
      ptyId: 1,
      terminal: {},
    } as unknown as Surface);
    const { getActiveCwd } = await import("../lib/services/service-helpers");
    const result = await getActiveCwd();
    expect(result).toBe("/home/user/project");
  });

  it("invokes get_pty_cwd when surface has no cwd but valid ptyId", async () => {
    activeSurface.set({
      kind: "terminal",
      id: "t1",
      ptyId: 5,
      terminal: {},
    } as unknown as Surface);
    mockedInvoke.mockResolvedValueOnce("/invoked/cwd" as never);

    const { getActiveCwd } = await import("../lib/services/service-helpers");
    const result = await getActiveCwd();
    expect(result).toBe("/invoked/cwd");
    expect(mockedInvoke).toHaveBeenCalledWith("get_pty_cwd", { ptyId: 5 });
  });

  it("returns undefined when invoke returns empty string", async () => {
    activeSurface.set({
      kind: "terminal",
      id: "t1",
      ptyId: 5,
      terminal: {},
    } as unknown as Surface);
    mockedInvoke.mockResolvedValueOnce("" as never);

    const { getActiveCwd } = await import("../lib/services/service-helpers");
    const result = await getActiveCwd();
    expect(result).toBeUndefined();
  });

  it("returns undefined when invoke throws", async () => {
    activeSurface.set({
      kind: "terminal",
      id: "t1",
      ptyId: 5,
      terminal: {},
    } as unknown as Surface);
    mockedInvoke.mockRejectedValueOnce(new Error("fail") as never);

    const { getActiveCwd } = await import("../lib/services/service-helpers");
    const result = await getActiveCwd();
    expect(result).toBeUndefined();
  });

  it("returns undefined when ptyId is negative", async () => {
    activeSurface.set({
      kind: "terminal",
      id: "t1",
      ptyId: -1,
      terminal: {},
    } as unknown as Surface);

    const { getActiveCwd } = await import("../lib/services/service-helpers");
    const result = await getActiveCwd();
    expect(result).toBeUndefined();
  });
});

describe("registerPtyForSurface", () => {
  it("makes lookupTerminalByPtyId find a surface whose ptyId was mutated after the store last emitted", async () => {
    // Simulate what connectPty does: surface is created with ptyId=-1,
    // store emits (index built with ptyId=-1, not inserted into _ptyIndex),
    // then spawn_pty resolves and surface.ptyId is mutated directly.
    // Without registerPtyForSurface the index stays stale and lookup returns undefined.
    const { default: getAllPanesMock, isTerminalSurface: isTermMock } =
      await import("../lib/types").then((m) => ({ default: m, ...m }));
    void getAllPanesMock;
    void isTermMock;

    const surface = {
      kind: "terminal",
      id: "surface-reg-test",
      ptyId: -1,
      terminal: { focus: vi.fn() },
    } as unknown as Surface;

    workspaces.set([]);

    const {
      lookupTerminalByPtyId,
      lookupPtyIdForSurface,
      registerPtyForSurface,
    } = await import("../lib/services/service-helpers");

    // Before registration: index has no entry for ptyId 42
    expect(lookupTerminalByPtyId(42)).toBeUndefined();

    // Simulate connectPty: mutate ptyId then register
    (surface as unknown as { ptyId: number }).ptyId = 42;
    registerPtyForSurface(
      42,
      surface as unknown as import("../lib/types").TerminalSurface,
    );

    expect(lookupTerminalByPtyId(42)).toBe(surface);
    expect(lookupPtyIdForSurface("surface-reg-test")).toBe(42);
  });
});
