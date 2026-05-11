/**
 * SSH surface unit tests:
 *   1. buildSshCommand — argv construction
 *   2. Config serialize/hydrate round-trip through workspace-runtime-service
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

// ---------------------------------------------------------------------------
// 1. buildSshCommand — pure function, no mocks needed
// ---------------------------------------------------------------------------

import { buildSshCommand } from "../lib/surfaces/ssh-surface";

describe("buildSshCommand", () => {
  it("produces minimal argv for host only", () => {
    const result = buildSshCommand({ host: "example.com" });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.command).toBe("ssh");
    expect(result.args).toEqual(["example.com"]);
  });

  it("prepends user@ when user is provided", () => {
    const result = buildSshCommand({ host: "example.com", user: "alice" });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.args).toEqual(["alice@example.com"]);
  });

  it("includes -i flag when identity is provided", () => {
    const result = buildSshCommand({
      host: "example.com",
      identity: "/home/user/.ssh/id_ed25519",
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.args).toContain("-i");
    expect(result.args).toContain("/home/user/.ssh/id_ed25519");
    // -i comes before the host
    const iIdx = result.args.indexOf("-i");
    const hostIdx = result.args.indexOf("example.com");
    expect(iIdx).toBeLessThan(hostIdx);
  });

  it("includes ServerAliveInterval when keepAlive is provided", () => {
    const result = buildSshCommand({ host: "example.com", keepAlive: 30 });
    expect(result).not.toBeNull();
    if (!result) return;
    const oIdx = result.args.indexOf("-o");
    expect(oIdx).toBeGreaterThanOrEqual(0);
    expect(result.args[oIdx + 1]).toBe("ServerAliveInterval=30");
  });

  it("includes -t remote-cwd snippet when cwd is provided", () => {
    const result = buildSshCommand({ host: "example.com", cwd: "/var/app" });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.args).toContain("-t");
    const tIdx = result.args.indexOf("-t");
    expect(result.args[tIdx + 1]).toBe("cd /var/app && exec $SHELL -l");
  });

  it("produces full argv with all options", () => {
    const result = buildSshCommand({
      host: "bastion.internal",
      user: "deploy",
      identity: "~/.ssh/deploy_key",
      keepAlive: 60,
      cwd: "/srv/myapp",
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.command).toBe("ssh");
    // Must contain all flags
    expect(result.args).toContain("-i");
    expect(result.args).toContain("~/.ssh/deploy_key");
    expect(result.args).toContain("-o");
    expect(result.args).toContain("ServerAliveInterval=60");
    expect(result.args).toContain("deploy@bastion.internal");
    expect(result.args).toContain("-t");
    expect(result.args).toContain("cd /srv/myapp && exec $SHELL -l");
    // Flags come before target
    const hostIdx = result.args.indexOf("deploy@bastion.internal");
    const iIdx = result.args.indexOf("-i");
    const oIdx = result.args.indexOf("-o");
    expect(iIdx).toBeLessThan(hostIdx);
    expect(oIdx).toBeLessThan(hostIdx);
  });

  it("returns null for empty host", () => {
    const result = buildSshCommand({ host: "" });
    expect(result).toBeNull();
  });

  it("returns null for whitespace-only host", () => {
    const result = buildSshCommand({ host: "   " });
    expect(result).toBeNull();
  });

  it("omits -i when identity is empty string", () => {
    const result = buildSshCommand({ host: "example.com", identity: "" });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.args).not.toContain("-i");
  });

  it("omits -o ServerAliveInterval when keepAlive is 0", () => {
    const result = buildSshCommand({ host: "example.com", keepAlive: 0 });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.args).not.toContain("-o");
  });

  it("omits -t when cwd is empty string", () => {
    const result = buildSshCommand({ host: "example.com", cwd: "" });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.args).not.toContain("-t");
  });
});

// ---------------------------------------------------------------------------
// 2. Serialize / hydrate round-trip through workspace-runtime-service
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Mock createTerminalSurface to capture the command/cwd passed to it
const createdSurfaces: Array<{
  pane: { surfaces: unknown[] };
  cwd?: string;
  command?: string;
  env?: Record<string, string>;
}> = [];

vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(
    async (
      pane: { surfaces: unknown[] },
      cwd?: string,
      env?: Record<string, string>,
    ) => {
      const stub = {
        kind: "terminal" as const,
        id: `t-${Math.random().toString(36).slice(2)}`,
        title: "stub",
        ptyId: -1,
        hasUnread: false,
        opened: false,
        startupCommand: undefined as string | undefined,
        definedCommand: undefined as string | undefined,
        // Provide a minimal terminal stub to avoid safeFocus rejections
        terminal: { focus: vi.fn() },
      };
      pane.surfaces.push(stub);
      createdSurfaces.push({ pane, cwd, env });
      return stub;
    },
  ),
}));

import {
  serializeLayout,
  createWorkspaceFromDef,
} from "../lib/services/workspace-runtime-service";
import { workspaces } from "../lib/stores/workspace";
import {
  isTerminalSurface,
  type Workspace,
  type TerminalSurface,
  type Pane,
} from "../lib/types";
import type { SshSurfaceConfig } from "../lib/surfaces/ssh-surface";

describe("SSH surface serialize / hydrate", () => {
  beforeEach(() => {
    workspaces.set([]);
    createdSurfaces.length = 0;
  });

  it("serializeLayout emits {type: 'ssh', sshConfig} for an SSH terminal surface", () => {
    // SSH surfaces are stored as TerminalSurface at runtime, with sshConfig attached
    const surface: TerminalSurface & { sshConfig: SshSurfaceConfig } = {
      kind: "terminal",
      id: "ssh-1",
      title: "ssh bastion",
      ptyId: 42,
      hasUnread: false,
      opened: true,
      terminal: {} as never,
      fitAddon: {} as never,
      searchAddon: {} as never,
      termElement: {} as never,
      sshConfig: { host: "bastion.internal", user: "deploy", keepAlive: 60 },
    };
    const pane: Pane = {
      id: "p1",
      surfaces: [surface],
      activeSurfaceId: "ssh-1",
    };
    const layout = serializeLayout({ type: "pane", pane });
    if (!("pane" in layout)) throw new Error("expected pane node");
    const surfaceDef = layout.pane.surfaces[0];
    expect(surfaceDef).toMatchObject({
      type: "ssh",
      sshConfig: { host: "bastion.internal", user: "deploy", keepAlive: 60 },
      focus: true,
    });
  });

  it("hydrates an ssh surface def into a TerminalSurface with startupCommand set", async () => {
    await createWorkspaceFromDef({
      name: "SSH WS",
      layout: {
        pane: {
          surfaces: [
            {
              type: "ssh" as "terminal", // cast: we extend SurfaceDef
              sshConfig: { host: "myserver.io", user: "root" },
              focus: true,
            } as never,
          ],
        },
      },
    });

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    const ws = list[0] as Workspace;
    expect(ws.paneLayout.type).toBe("pane");
    if (ws.paneLayout.type !== "pane") return;
    const surfaces = ws.paneLayout.pane.surfaces;
    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0]!;
    expect(isTerminalSurface(surface)).toBe(true);
    if (!isTerminalSurface(surface)) return;
    // The startup command should be the built ssh command
    expect(surface.startupCommand).toMatch(/^ssh\s/);
    expect(surface.startupCommand).toContain("root@myserver.io");
  });

  it("round-trips ssh config losslessly through serialize then createWorkspaceFromDef", async () => {
    // Build a fake TerminalSurface with sshConfig
    const sshConfig: SshSurfaceConfig = {
      host: "prod.example.com",
      user: "ci",
      identity: "/home/ci/.ssh/id_rsa",
      keepAlive: 45,
    };
    const surface: TerminalSurface & { sshConfig: SshSurfaceConfig } = {
      kind: "terminal",
      id: "ssh-rt",
      title: "prod ssh",
      ptyId: -1,
      hasUnread: false,
      opened: false,
      terminal: {} as never,
      fitAddon: {} as never,
      searchAddon: {} as never,
      termElement: {} as never,
      sshConfig,
    };
    const pane: Pane = {
      id: "p-rt",
      surfaces: [surface],
      activeSurfaceId: "ssh-rt",
    };
    const layout = serializeLayout({ type: "pane", pane });

    // Now hydrate
    await createWorkspaceFromDef({ name: "Round-trip SSH", layout });

    const ws = get(workspaces)[0] as Workspace;
    if (!ws || ws.paneLayout.type !== "pane") throw new Error("expected ws");
    const restored = ws.paneLayout.pane.surfaces[0]!;
    expect(isTerminalSurface(restored)).toBe(true);
    if (!isTerminalSurface(restored)) return;
    // The startup command must include all config fields
    expect(restored.startupCommand).toContain("-i");
    expect(restored.startupCommand).toContain("/home/ci/.ssh/id_rsa");
    expect(restored.startupCommand).toContain("ServerAliveInterval=45");
    expect(restored.startupCommand).toContain("ci@prod.example.com");
  });

  it("falls back to terminal when ssh config has empty host", async () => {
    await createWorkspaceFromDef({
      name: "Bad SSH WS",
      layout: {
        pane: {
          surfaces: [
            {
              type: "ssh" as "terminal",
              sshConfig: { host: "" },
            } as never,
          ],
        },
      },
    });

    const ws = get(workspaces)[0] as Workspace;
    if (!ws || ws.paneLayout.type !== "pane") throw new Error("expected ws");
    // Falls back to a plain terminal (1 surface still created)
    expect(ws.paneLayout.pane.surfaces).toHaveLength(1);
    const surface = ws.paneLayout.pane.surfaces[0]!;
    // It's still a terminal surface, just without an ssh startup command targeting a host
    expect(isTerminalSurface(surface)).toBe(true);
    if (!isTerminalSurface(surface)) return;
    // startupCommand should not contain "ssh" since config is invalid
    expect(surface.startupCommand ?? "").not.toMatch(/^ssh\s.*@/);
  });
});
