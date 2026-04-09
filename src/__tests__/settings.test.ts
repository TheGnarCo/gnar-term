/**
 * Tests for the settings system — settings.json loading, defaults, project overrides
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadProjectSettings,
  getSettings,
  saveSettings,
  mergeHarnessPresets,
  _resetForTesting,
  type Settings,
  type StatusDetectionSettings,
  type TerminalSettings,
  type ShellSettings,
  type AccessibilitySettings,
  type HarnessSettings,
} from "../lib/settings";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function setupInvoke(files: Record<string, string>) {
  mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === "get_home") return "/Users/test";
    if (cmd === "read_file") {
      const path = (args as any)?.path;
      if (path && files[path]) return files[path];
      throw new Error(`File not found: ${path}`);
    }
    if (cmd === "write_file") return undefined;
    if (cmd === "ensure_dir") return undefined;
    throw new Error(`Unknown command: ${cmd}`);
  });
}

describe("DEFAULT_SETTINGS", () => {
  it("has sensible defaults for all fields", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("tokyo-night");
    expect(DEFAULT_SETTINGS.fontSize).toBe(14);
    expect(DEFAULT_SETTINGS.fontFamily).toBeDefined();
    expect(DEFAULT_SETTINGS.opacity).toBe(1.0);
  });

  it("includes a default harness preset for Claude Code", () => {
    const claude = DEFAULT_SETTINGS.harnesses.find((h) => h.id === "claude");
    expect(claude).toBeDefined();
    expect(claude!.name).toBe("Claude Code");
    expect(claude!.command).toBe("claude");
  });

  it("sets claude as the default harness", () => {
    expect(DEFAULT_SETTINGS.defaultHarness).toBe("claude");
  });

  it("has default keybindings", () => {
    expect(DEFAULT_SETTINGS.keybindings.home).toBeDefined();
    expect(DEFAULT_SETTINGS.keybindings.newWorktree).toBeDefined();
    expect(DEFAULT_SETTINGS.keybindings.toggleRightSidebar).toBeDefined();
    expect(DEFAULT_SETTINGS.keybindings.stashWorkspace).toBeDefined();
  });

  it("has default status detection settings", () => {
    const sd = DEFAULT_SETTINGS.statusDetection;
    expect(sd.oscNotifications).toBe(true);
    expect(sd.titleParsing).toBe(true);
    expect(sd.processMonitoring).toBe(true);
    expect(sd.idleThresholdMs).toBe(5000);
  });

  it("defaults worktreeBaseDir to nested", () => {
    expect(DEFAULT_SETTINGS.worktreeBaseDir).toBe("nested");
  });

  it("defaults autoload to empty array", () => {
    expect(DEFAULT_SETTINGS.autoload).toEqual([]);
  });
});

describe("loadSettings()", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("returns defaults when no settings file exists", async () => {
    setupInvoke({});
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("loads and merges settings from file", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        theme: "dracula",
        fontSize: 16,
      }),
    });

    const settings = await loadSettings();
    expect(settings.theme).toBe("dracula");
    expect(settings.fontSize).toBe(16);
    // Defaults still present for unspecified fields
    expect(settings.opacity).toBe(DEFAULT_SETTINGS.opacity);
    expect(settings.harnesses).toEqual(DEFAULT_SETTINGS.harnesses);
  });

  it("deep-merges keybindings with defaults", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        keybindings: { home: "ctrl+h" },
      }),
    });

    const settings = await loadSettings();
    expect(settings.keybindings.home).toBe("ctrl+h");
    expect(settings.keybindings.newWorktree).toBe(
      DEFAULT_SETTINGS.keybindings.newWorktree,
    );
  });

  it("deep-merges statusDetection with defaults", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        statusDetection: { idleThresholdMs: 10000 },
      }),
    });

    const settings = await loadSettings();
    expect(settings.statusDetection.idleThresholdMs).toBe(10000);
    expect(settings.statusDetection.oscNotifications).toBe(true);
  });

  it("handles malformed JSON gracefully", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": "not valid json {{{",
    });

    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("merges user harnesses with defaults by id", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        harnesses: [
          { id: "codex", name: "Codex", command: "codex", args: [], env: {} },
        ],
      }),
    });

    const settings = await loadSettings();
    // Default claude preset still present
    expect(settings.harnesses.find((h) => h.id === "claude")).toBeDefined();
    // User-added codex preset present
    expect(settings.harnesses.find((h) => h.id === "codex")).toBeDefined();
  });

  it("user harnesses override defaults with same id", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        harnesses: [
          {
            id: "claude",
            name: "Claude (Custom)",
            command: "claude",
            args: ["--fast"],
            env: {},
          },
        ],
      }),
    });

    const settings = await loadSettings();
    const claude = settings.harnesses.find((h) => h.id === "claude");
    expect(claude!.name).toBe("Claude (Custom)");
    expect(claude!.args).toEqual(["--fast"]);
  });
});

describe("loadProjectSettings()", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("returns base settings when no project config exists", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        theme: "dracula",
      }),
    });

    const base = await loadSettings();
    const merged = await loadProjectSettings("/some/project", base);
    expect(merged).toEqual(base);
  });

  it("merges project harnesses by id", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({}),
      "/some/project/.gnar/settings.json": JSON.stringify({
        harnesses: [
          {
            id: "claude-review",
            name: "Claude (Review)",
            command: "claude",
            args: ["--permission-mode", "plan"],
            env: {},
          },
        ],
      }),
    });

    const base = await loadSettings();
    const merged = await loadProjectSettings("/some/project", base);
    // Original claude still present
    expect(merged.harnesses.find((h) => h.id === "claude")).toBeDefined();
    // Project-added preset present
    expect(
      merged.harnesses.find((h) => h.id === "claude-review"),
    ).toBeDefined();
  });

  it("project settings override global for simple fields", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        defaultHarness: "claude",
        worktreePrefix: "global/",
      }),
      "/some/project/.gnar/settings.json": JSON.stringify({
        defaultHarness: "codex",
        worktreePrefix: "team/",
      }),
    });

    const base = await loadSettings();
    const merged = await loadProjectSettings("/some/project", base);
    expect(merged.defaultHarness).toBe("codex");
    expect(merged.worktreePrefix).toBe("team/");
  });

  it("does not allow project config to override non-overrideable fields", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        theme: "tokyo-night",
        fontSize: 14,
      }),
      "/some/project/.gnar/settings.json": JSON.stringify({
        theme: "hacked",
        fontSize: 99,
        defaultHarness: "codex",
      }),
    });

    const base = await loadSettings();
    const merged = await loadProjectSettings("/some/project", base);
    // Non-overrideable fields stay from base
    expect(merged.theme).toBe("tokyo-night");
    expect(merged.fontSize).toBe(14);
    // Overrideable field changes
    expect(merged.defaultHarness).toBe("codex");
  });

  it("handles malformed project config gracefully", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({}),
      "/some/project/.gnar/settings.json": "broken json!!",
    });

    const base = await loadSettings();
    const merged = await loadProjectSettings("/some/project", base);
    expect(merged).toEqual(base);
  });
});

describe("mergeHarnessPresets()", () => {
  it("adds new presets without removing existing", () => {
    const base = [
      { id: "claude", name: "Claude", command: "claude", args: [], env: {} },
    ];
    const overrides = [
      { id: "codex", name: "Codex", command: "codex", args: [], env: {} },
    ];
    const result = mergeHarnessPresets(base, overrides);
    expect(result).toHaveLength(2);
    expect(result.find((h) => h.id === "claude")).toBeDefined();
    expect(result.find((h) => h.id === "codex")).toBeDefined();
  });

  it("overrides preset with matching id", () => {
    const base = [
      { id: "claude", name: "Claude", command: "claude", args: [], env: {} },
    ];
    const overrides = [
      {
        id: "claude",
        name: "Claude Custom",
        command: "claude",
        args: ["--fast"],
        env: {},
      },
    ];
    const result = mergeHarnessPresets(base, overrides);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Claude Custom");
    expect(result[0].args).toEqual(["--fast"]);
  });

  it("deep-merges individual fields when override matches by id", () => {
    const base = [
      {
        id: "claude",
        name: "Claude",
        command: "claude",
        args: [],
        env: {},
        icon: "claude",
      },
    ];
    const overrides = [{ id: "claude", args: ["--fast"] } as any];
    const result = mergeHarnessPresets(base, overrides);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Claude");
    expect(result[0].icon).toBe("claude");
    expect(result[0].args).toEqual(["--fast"]);
  });

  it("preserves order: base items first, then new overrides", () => {
    const base = [
      { id: "a", name: "A", command: "a", args: [], env: {} },
      { id: "b", name: "B", command: "b", args: [], env: {} },
    ];
    const overrides = [
      { id: "c", name: "C", command: "c", args: [], env: {} },
      { id: "a", name: "A2", command: "a", args: ["--v2"], env: {} },
    ];
    const result = mergeHarnessPresets(base, overrides);
    expect(result.map((h) => h.id)).toEqual(["a", "b", "c"]);
    expect(result[0].name).toBe("A2");
  });
});

describe("getSettings()", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("returns current settings after load", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        theme: "monokai",
      }),
    });

    await loadSettings();
    const settings = getSettings();
    expect(settings.theme).toBe("monokai");
  });
});

describe("saveSettings()", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("writes settings to the config file", async () => {
    setupInvoke({});
    await loadSettings();
    await saveSettings({ theme: "solarized" });

    expect(mockInvoke).toHaveBeenCalledWith("ensure_dir", {
      path: "/Users/test/.config/gnar",
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      "write_file",
      expect.objectContaining({
        path: "/Users/test/.config/gnar/settings.json",
      }),
    );

    // Verify the written content includes the updated theme
    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === "write_file");
    const written = JSON.parse((writeCall![1] as any).content);
    expect(written.theme).toBe("solarized");
  });

  it("updates getSettings() after save", async () => {
    setupInvoke({});
    await loadSettings();
    await saveSettings({ fontSize: 18 });
    expect(getSettings().fontSize).toBe(18);
  });

  it("does not mutate state when write fails", async () => {
    setupInvoke({});
    await loadSettings();
    const before = getSettings().theme;

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") return "/Users/test";
      if (cmd === "ensure_dir") return undefined;
      if (cmd === "write_file") throw new Error("disk full");
      throw new Error(`Unknown: ${cmd}`);
    });

    await expect(saveSettings({ theme: "broken" })).rejects.toThrow(
      "disk full",
    );
    expect(getSettings().theme).toBe(before);
  });

  it("deep-merges keybindings on save", async () => {
    setupInvoke({});
    await loadSettings();
    await saveSettings({ keybindings: { home: "ctrl+h" } } as any);

    const kb = getSettings().keybindings;
    expect(kb.home).toBe("ctrl+h");
    expect(kb.newWorktree).toBe(DEFAULT_SETTINGS.keybindings.newWorktree);
  });

  it("deep-merges statusDetection on save", async () => {
    setupInvoke({});
    await loadSettings();
    await saveSettings({ statusDetection: { idleThresholdMs: 9999 } } as any);

    const sd = getSettings().statusDetection;
    expect(sd.idleThresholdMs).toBe(9999);
    expect(sd.oscNotifications).toBe(true);
  });
});

describe("loadSettings() fallback to defaults", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("returns defaults when no config files exist", async () => {
    setupInvoke({});

    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});

// --- S3: Settings Foundation tests ---

describe("DEFAULT_SETTINGS — new sub-objects", () => {
  it("has terminal settings with correct defaults", () => {
    expect(DEFAULT_SETTINGS.terminal).toEqual({
      scrollback: 5000,
      cursorStyle: "block",
      cursorBlink: true,
    });
  });

  it("has shell settings with correct defaults", () => {
    expect(DEFAULT_SETTINGS.shell).toEqual({
      path: null,
      args: [],
    });
  });

  it("has accessibility settings with correct defaults", () => {
    expect(DEFAULT_SETTINGS.accessibility).toEqual({
      reducedMotion: false,
    });
  });

  it("has harnessSettings with correct defaults", () => {
    expect(DEFAULT_SETTINGS.harnessSettings).toEqual({
      notifyOnWaiting: true,
    });
  });
});

describe("mergeWithDefaults — new sub-objects", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("deep-merges terminal settings with defaults", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        terminal: { scrollback: 10000 },
      }),
    });

    const settings = await loadSettings();
    expect(settings.terminal.scrollback).toBe(10000);
    expect(settings.terminal.cursorStyle).toBe("block");
    expect(settings.terminal.cursorBlink).toBe(true);
  });

  it("deep-merges shell settings with defaults", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        shell: { path: "/bin/zsh" },
      }),
    });

    const settings = await loadSettings();
    expect(settings.shell.path).toBe("/bin/zsh");
    expect(settings.shell.args).toEqual([]);
  });

  it("deep-merges accessibility settings with defaults", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        accessibility: { reducedMotion: true },
      }),
    });

    const settings = await loadSettings();
    expect(settings.accessibility.reducedMotion).toBe(true);
  });

  it("deep-merges harnessSettings with defaults", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        harnessSettings: { notifyOnWaiting: false },
      }),
    });

    const settings = await loadSettings();
    expect(settings.harnessSettings.notifyOnWaiting).toBe(false);
  });

  it("handles partial terminal overrides (only scrollback set)", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        terminal: { scrollback: 2000 },
      }),
    });

    const settings = await loadSettings();
    expect(settings.terminal).toEqual({
      scrollback: 2000,
      cursorStyle: "block",
      cursorBlink: true,
    });
  });

  it("handles partial shell overrides (only args set)", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        shell: { args: ["--login"] },
      }),
    });

    const settings = await loadSettings();
    expect(settings.shell.path).toBeNull();
    expect(settings.shell.args).toEqual(["--login"]);
  });

  it("returns all defaults when no sub-objects are specified", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        theme: "dracula",
      }),
    });

    const settings = await loadSettings();
    expect(settings.terminal).toEqual(DEFAULT_SETTINGS.terminal);
    expect(settings.shell).toEqual(DEFAULT_SETTINGS.shell);
    expect(settings.accessibility).toEqual(DEFAULT_SETTINGS.accessibility);
    expect(settings.harnessSettings).toEqual(DEFAULT_SETTINGS.harnessSettings);
  });

  it("overrides all terminal fields when all are specified", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        terminal: { scrollback: 1000, cursorStyle: "bar", cursorBlink: false },
      }),
    });

    const settings = await loadSettings();
    expect(settings.terminal).toEqual({
      scrollback: 1000,
      cursorStyle: "bar",
      cursorBlink: false,
    });
  });
});

describe("saveSettings — new sub-objects", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("deep-merges terminal settings on save", async () => {
    setupInvoke({});
    await loadSettings();
    await saveSettings({ terminal: { scrollback: 3000 } } as any);

    const t = getSettings().terminal;
    expect(t.scrollback).toBe(3000);
    expect(t.cursorStyle).toBe("block");
    expect(t.cursorBlink).toBe(true);
  });

  it("deep-merges shell settings on save", async () => {
    setupInvoke({});
    await loadSettings();
    await saveSettings({ shell: { path: "/usr/local/bin/fish" } } as any);

    const s = getSettings().shell;
    expect(s.path).toBe("/usr/local/bin/fish");
    expect(s.args).toEqual([]);
  });

  it("deep-merges accessibility settings on save", async () => {
    setupInvoke({});
    await loadSettings();
    await saveSettings({
      accessibility: { reducedMotion: true },
    } as any);

    expect(getSettings().accessibility.reducedMotion).toBe(true);
  });

  it("deep-merges harnessSettings on save", async () => {
    setupInvoke({});
    await loadSettings();
    await saveSettings({
      harnessSettings: { notifyOnWaiting: false },
    } as any);

    expect(getSettings().harnessSettings.notifyOnWaiting).toBe(false);
  });
});

describe("settings round-trip — new sub-objects", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("round-trips terminal, shell, accessibility, harnessSettings through save/load", async () => {
    let savedContent = "";
    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "get_home") return "/Users/test";
      if (cmd === "read_file") {
        const path = (args as any)?.path;
        if (path === "/Users/test/.config/gnar/settings.json" && savedContent) {
          return savedContent;
        }
        throw new Error("File not found");
      }
      if (cmd === "write_file") {
        savedContent = (args as any).content;
        return undefined;
      }
      if (cmd === "ensure_dir") return undefined;
      throw new Error(`Unknown command: ${cmd}`);
    });

    await loadSettings();
    await saveSettings({
      terminal: {
        scrollback: 8000,
        cursorStyle: "underline",
        cursorBlink: false,
      },
      shell: { path: "/bin/bash", args: ["-l"] },
      accessibility: { reducedMotion: true },
      harnessSettings: { notifyOnWaiting: false },
    });

    // Reset and reload from the "saved" content
    _resetForTesting();
    const reloaded = await loadSettings();

    expect(reloaded.terminal).toEqual({
      scrollback: 8000,
      cursorStyle: "underline",
      cursorBlink: false,
    });
    expect(reloaded.shell).toEqual({
      path: "/bin/bash",
      args: ["-l"],
    });
    expect(reloaded.accessibility).toEqual({ reducedMotion: true });
    expect(reloaded.harnessSettings).toEqual({ notifyOnWaiting: false });
  });
});
