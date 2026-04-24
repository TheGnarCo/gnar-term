/**
 * Tests for the P6 batch of markdown-components registered by the
 * agentic-orchestrator extension: Kanban, Issues, AgentList,
 * AgentStatusRow, TaskSpawner.
 *
 * Verifies registration through registerMarkdownComponent, listing
 * via the registry, and the per-component rendering / interaction
 * contracts (kanban bucketing, agent click → jump, task spawner
 * collapsed↔expanded toggle, etc.).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { tick } from "svelte";

const { tauriInvokeGhAvailable } = vi.hoisted(() => ({
  tauriInvokeGhAvailable: { current: true as boolean },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    if (cmd === "gh_available") return tauriInvokeGhAvailable.current;
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));
vi.mock("../../../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn().mockResolvedValue({}),
  saveExtensionState: vi.fn().mockResolvedValue(undefined),
  deleteExtensionState: vi.fn().mockResolvedValue(undefined),
}));

const { spawnAgentInWorktreeMock } = vi.hoisted(() => ({
  spawnAgentInWorktreeMock: vi.fn().mockResolvedValue({
    surface_id: "surf-1",
    workspace_id: "ws-1",
    pane_id: "pane-1",
    branch: "agent/claude-code/abc",
    worktree_path: "/work/proj-agent-claude-code-abc",
  }),
}));

vi.mock("../../../lib/services/spawn-helper", () => ({
  spawnAgentInWorktree: spawnAgentInWorktreeMock,
}));

vi.mock("../../../lib/services/workspace-service", () => ({
  createWorkspaceFromDef: vi.fn().mockResolvedValue("ws-new"),
  closeWorkspace: vi.fn(),
}));

const { configRef, saveConfigMock } = vi.hoisted(() => {
  const ref: { current: Record<string, unknown> } = { current: {} };
  return {
    configRef: ref,
    saveConfigMock: vi.fn(async (updates: Record<string, unknown>) => {
      ref.current = { ...ref.current, ...updates };
    }),
  };
});

vi.mock("../../../lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config")>();
  return {
    ...actual,
    getConfig: () => configRef.current,
    saveConfig: saveConfigMock,
  };
});

vi.mock("../../../lib/stores/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/stores/workspace")>();
  return actual;
});

import {
  agenticOrchestratorManifest,
  registerAgenticOrchestratorExtension,
} from "..";
import {
  registerExtension,
  activateExtension,
  deactivateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";
import {
  getMarkdownComponent,
  listMarkdownComponents,
  resetMarkdownComponents,
} from "../../../lib/services/markdown-component-registry";
import type { AgentRef as DetectedAgent } from "../../api";

// Local writable that stands in for the core agentsStore during testing.
// Each makeApi() reassigns a new one into this ref; registerAgent appends,
// resetRegistry clears. Mimics the pre-move `agent-registry` surface so the
// rest of the test bodies can stay unchanged.
const _testAgentsRef: { store: ReturnType<typeof writable<DetectedAgent[]>> } =
  {
    store: writable<DetectedAgent[]>([]),
  };
function registerAgent(agent: DetectedAgent): void {
  _testAgentsRef.store.update((list) => [...list, agent]);
}
function resetRegistry(): void {
  _testAgentsRef.store.set([]);
}
import { invalidateGhAvailability } from "../../../lib/services/gh-availability";
import ExtensionWrapper from "../../../lib/components/ExtensionWrapper.svelte";
import Kanban from "../components/Kanban.svelte";
import Issues from "../components/Issues.svelte";
import Prs from "../components/Prs.svelte";
import AgentList from "../components/AgentList.svelte";
import AgentStatusRow from "../components/AgentStatusRow.svelte";
import TaskSpawner from "../components/TaskSpawner.svelte";
import { themes } from "../../../lib/theme-data";
import type { ExtensionAPI } from "../../../extensions/api";

const COMPONENT_NAMES = [
  "kanban",
  "issues",
  "prs",
  "agent-list",
  "agent-status-row",
  "task-spawner",
  "columns",
] as const;

const { switchSpy, focusSpy, invokeSpy } = vi.hoisted(() => ({
  switchSpy: vi.fn(),
  focusSpy: vi.fn(),
  invokeSpy: vi.fn(),
}));

function makeApi(
  options: {
    agents?: DetectedAgent[];
    workspaces?: Array<{ id: string; name: string }>;
    invoke?: (cmd: string, args?: unknown) => unknown;
  } = {},
): ExtensionAPI {
  const stateMap = new Map<string, unknown>();
  _testAgentsRef.store = writable<DetectedAgent[]>(options.agents ?? []);
  return {
    state: {
      get: <T>(key: string) => stateMap.get(key) as T | undefined,
      set: (key: string, v: unknown) => {
        stateMap.set(key, v);
      },
    },
    theme: writable(themes["github-dark"]),
    workspaces: writable(options.workspaces ?? []),
    agents: _testAgentsRef.store,
    invoke: options.invoke
      ? vi.fn(async (cmd: string, args?: unknown) => options.invoke!(cmd, args))
      : invokeSpy,
    switchWorkspace: switchSpy,
    focusSurface: focusSpy,
  } as unknown as ExtensionAPI;
}

function makeAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return {
    agentId: overrides.agentId ?? "agent-1",
    agentName: overrides.agentName ?? "Claude Code",
    surfaceId: overrides.surfaceId ?? "surface-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    status: overrides.status ?? "running",
    createdAt: overrides.createdAt ?? "2026-04-19T00:00:00.000Z",
    lastStatusChange: overrides.lastStatusChange ?? "2026-04-19T00:00:00.000Z",
  };
}

// --- Registration / listing ---

describe("agentic-orchestrator markdown-components: registration", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetMarkdownComponents();
    resetRegistry();
    configRef.current = {};
  });

  it("registers all five components on activation", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    for (const name of COMPONENT_NAMES) {
      const c = getMarkdownComponent(name);
      expect(c, `expected component "${name}" to be registered`).toBeDefined();
      expect(c!.source).toBe("agentic-orchestrator");
    }
  });

  it("all five appear in listMarkdownComponents()", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const list = listMarkdownComponents()
      .filter((c) => c.source === "agentic-orchestrator")
      .map((c) => c.name)
      .sort();
    expect(list).toEqual([...COMPONENT_NAMES].sort());
  });

  it("deactivation removes all five components", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");
    deactivateExtension("agentic-orchestrator");

    for (const name of COMPONENT_NAMES) {
      expect(getMarkdownComponent(name)).toBeUndefined();
    }
  });

  it("each component carries a configSchema entry on the registry", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    for (const name of COMPONENT_NAMES) {
      const c = getMarkdownComponent(name);
      expect(c?.configSchema).toBeDefined();
    }
  });
});

// --- Kanban ---

describe("Kanban widget", () => {
  beforeEach(async () => {
    configRef.current = {};
    saveConfigMock.mockClear();
    resetRegistry();
    switchSpy.mockReset();
    focusSpy.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders four columns by default (no agents)", () => {
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi(),
        component: Kanban,
        props: {},
        host: { metadata: { isGlobalAgenticDashboard: true } },
      },
    });
    const cols = container.querySelectorAll("[data-kanban-column]");
    expect(cols.length).toBe(4);
    const ids = Array.from(cols).map((c) =>
      c.getAttribute("data-kanban-column"),
    );
    expect(ids).toEqual(["running", "waiting", "idle", "done"]);
    // All columns show empty placeholder
    expect(container.querySelectorAll("[data-kanban-empty]").length).toBe(4);
  });

  it("buckets agents into the correct columns when scoped to a group host", async () => {
    // Seed an api whose agentsStore receives the agents we register through
    // the registry. Since the widget reads agentsStore directly, we drive
    // it through registerAgent (which syncs the store).
    const api = makeApi();
    // Detection moved to core; makeApi() wires api.agents to the test writable.

    // Match the dashboard scope by giving each agent a workspace whose
    // first terminal cwd is under /work/proj.
    const wsStore = (await import("../../../lib/stores/workspace")) as {
      workspaces: { set: (v: unknown) => void };
    };
    wsStore.workspaces.set([
      {
        id: "ws-running",
        name: "Run",
        activePaneId: "p",
        splitRoot: {
          type: "pane",
          pane: {
            id: "p",
            activeSurfaceId: "s1",
            surfaces: [
              {
                id: "s1",
                kind: "terminal",
                title: "claude",
                cwd: "/work/proj/sub",
                ptyId: 1,
                terminal: { dispose: vi.fn(), focus: vi.fn() },
              },
            ],
          },
        },
      },
      {
        id: "ws-waiting",
        name: "Wait",
        activePaneId: "p",
        splitRoot: {
          type: "pane",
          pane: {
            id: "p",
            activeSurfaceId: "s2",
            surfaces: [
              {
                id: "s2",
                kind: "terminal",
                title: "claude",
                cwd: "/work/proj/other",
                ptyId: 2,
                terminal: { dispose: vi.fn(), focus: vi.fn() },
              },
            ],
          },
        },
      },
      {
        id: "ws-idle",
        name: "Idle",
        activePaneId: "p",
        splitRoot: {
          type: "pane",
          pane: {
            id: "p",
            activeSurfaceId: "s3",
            surfaces: [
              {
                id: "s3",
                kind: "terminal",
                title: "claude",
                cwd: "/work/proj/again",
                ptyId: 3,
                terminal: { dispose: vi.fn(), focus: vi.fn() },
              },
            ],
          },
        },
      },
    ]);

    registerAgent(
      makeAgent({
        agentId: "a-running",
        workspaceId: "ws-running",
        status: "running",
      }),
    );
    registerAgent(
      makeAgent({
        agentId: "a-waiting",
        workspaceId: "ws-waiting",
        status: "waiting",
      }),
    );
    registerAgent(
      makeAgent({
        agentId: "a-idle",
        workspaceId: "ws-idle",
        status: "idle",
      }),
    );

    // Seed a workspace group whose path matches the workspaces' CWD so
    // the host-context-driven filter includes them as unclaimed CWD
    // matches — mirroring the group-scope rule in widget-helpers.
    const { setWorkspaceGroups, resetWorkspaceGroupsForTest } =
      await import("../../../lib/stores/workspace-groups");
    resetWorkspaceGroupsForTest();
    setWorkspaceGroups([
      {
        id: "group-proj",
        name: "Project A",
        path: "/work/proj",
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: [],
      },
    ]);

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Kanban,
        props: {},
        host: { metadata: { groupId: "group-proj" } },
      },
    });

    await tick();

    const colRunning = container.querySelector(
      '[data-kanban-column="running"]',
    );
    const colWaiting = container.querySelector(
      '[data-kanban-column="waiting"]',
    );
    const colIdle = container.querySelector('[data-kanban-column="idle"]');
    const colDone = container.querySelector('[data-kanban-column="done"]');

    expect(colRunning?.querySelectorAll("[data-kanban-card]").length).toBe(1);
    expect(colWaiting?.querySelectorAll("[data-kanban-card]").length).toBe(1);
    expect(colIdle?.querySelectorAll("[data-kanban-card]").length).toBe(1);
    expect(colDone?.querySelectorAll("[data-kanban-card]").length).toBe(0);
  });
});

// --- Issues ---

describe("Issues widget", () => {
  const GROUP_ID = "grp-issues";
  const GROUP_PATH = "/work/proj";
  const groupHost = { metadata: { groupId: GROUP_ID } };

  beforeEach(async () => {
    configRef.current = {};
    saveConfigMock.mockClear();
    resetRegistry();
    // The gh-availability cache is module-level; clearing it between
    // tests prevents a previous test's gh_available mock from bleeding
    // into the next one.
    invalidateGhAvailability();
    tauriInvokeGhAvailable.current = true;
    const { setWorkspaceGroups, resetWorkspaceGroupsForTest } =
      await import("../../../lib/stores/workspace-groups");
    resetWorkspaceGroupsForTest();
    setWorkspaceGroups([
      {
        id: GROUP_ID,
        name: "Issues Dash",
        path: GROUP_PATH,
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: [],
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders rows for issues returned by gh_list_issues", async () => {
    const fakeIssues = [
      {
        number: 1,
        title: "First issue",
        state: "open",
        author: { login: "octocat" },
        labels: [{ name: "bug", color: "ff0000" }],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/1",
      },
      {
        number: 2,
        title: "Second issue",
        state: "open",
        author: { login: "alxjrvs" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/2",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_issues") return fakeIssues;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Issues,
        props: {},
        host: groupHost,
      },
    });

    // The first fetch is fired in onMount — wait a microtask for it.
    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    const rows = container.querySelectorAll("[data-issue-row]");
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute("data-issue-number")).toBe("1");
    expect(container.querySelector("[data-issues-empty]") ?? null).toBeNull();

    // P7: Spawn buttons are real (enabled) split-buttons.
    const spawnBtns = container.querySelectorAll("[data-issue-spawn]");
    expect(spawnBtns.length).toBe(2);
    spawnBtns.forEach((b) => {
      expect((b as HTMLButtonElement).disabled).toBe(false);
    });
    // Each row also has a caret button for the agent picker.
    const caretBtns = container.querySelectorAll("[data-issue-spawn-caret]");
    expect(caretBtns.length).toBe(2);
  });

  it("clicking the default spawn button invokes spawnAgentInWorktree with claude-code + issue context", async () => {
    spawnAgentInWorktreeMock.mockClear();
    const fakeIssues = [
      {
        number: 7,
        title: "Make it faster",
        state: "open",
        author: { login: "me" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/7",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_issues") return fakeIssues;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Issues,
        props: {},
        host: groupHost,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    const spawnBtn = container.querySelector(
      "[data-issue-spawn]",
    ) as HTMLButtonElement;
    expect(spawnBtn).not.toBeNull();
    await fireEvent.click(spawnBtn);
    await tick();
    await tick();

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(1);
    const callArg = spawnAgentInWorktreeMock.mock.calls[0]?.[0];
    expect(callArg).toMatchObject({
      agent: "claude-code",
      repoPath: GROUP_PATH,
      groupId: GROUP_ID,
      spawnedBy: { kind: "group", groupId: GROUP_ID },
    });
    expect(callArg.taskContext).toContain("Issue #7");
    expect(callArg.taskContext).toContain("Make it faster");
    expect(callArg.branch).toBe("agent/claude-code/7-make-it-faster");
  });

  it("opening the caret menu and choosing aider invokes spawnAgentInWorktree with that agent", async () => {
    spawnAgentInWorktreeMock.mockClear();
    const fakeIssues = [
      {
        number: 9,
        title: "Refactor X",
        state: "open",
        author: { login: "me" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/9",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_issues") return fakeIssues;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Issues,
        props: {},
        host: groupHost,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    const caret = container.querySelector(
      "[data-issue-spawn-caret]",
    ) as HTMLButtonElement;
    await fireEvent.click(caret);
    await tick();

    const aiderOption = container.querySelector(
      '[data-issue-spawn-option="aider"]',
    ) as HTMLElement;
    expect(aiderOption).not.toBeNull();
    await fireEvent.click(aiderOption);
    await tick();
    await tick();

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(1);
    expect(spawnAgentInWorktreeMock.mock.calls[0]?.[0]).toMatchObject({
      agent: "aider",
    });
  });

  it("renders the actionable gh-missing panel when gh_available resolves false", async () => {
    tauriInvokeGhAvailable.current = false;
    const invokeFn = vi.fn(async () => undefined);
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Issues,
        props: {},
        host: groupHost,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    const missing = container.querySelector("[data-issues-gh-missing]");
    expect(missing).not.toBeNull();
    expect(missing?.textContent).toContain("GitHub CLI not available");
    expect(missing?.textContent).toContain("gh auth login");
    const retry = container.querySelector(
      "[data-issues-gh-missing-retry]",
    ) as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
  });

  it("displayOnly suppresses the per-row Spawn split-button group", async () => {
    const fakeIssues = [
      {
        number: 11,
        title: "Read-only mount",
        state: "open",
        author: { login: "octocat" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/11",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_issues") return fakeIssues;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Issues,
        props: { displayOnly: true },
        host: groupHost,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    expect(container.querySelectorAll("[data-issue-row]").length).toBe(1);
    expect(container.querySelector("[data-issue-spawn-group]")).toBeNull();
    expect(container.querySelector("[data-issue-spawn]")).toBeNull();
    expect(container.querySelector("[data-issue-spawn-caret]")).toBeNull();
    expect(container.querySelector("[data-issue-select]")).toBeNull();
  });

  it("checking 2+ issues shows the bulk toolbar; Spawn All fans out one call per selection", async () => {
    spawnAgentInWorktreeMock.mockClear();
    const fakeIssues = [
      {
        number: 21,
        title: "First",
        state: "open",
        author: { login: "me" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/21",
      },
      {
        number: 22,
        title: "Second",
        state: "open",
        author: { login: "me" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/22",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_issues") return fakeIssues;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: { api, component: Issues, props: {}, host: groupHost },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    // Toolbar is always present; buttons are disabled until something is selected.
    const toolbarBefore = container.querySelector("[data-issues-bulk-toolbar]");
    expect(toolbarBefore).not.toBeNull();
    expect(toolbarBefore?.getAttribute("data-selection-count")).toBe("0");
    expect(
      (container.querySelector("[data-issues-spawn-all]") as HTMLButtonElement)
        ?.disabled,
    ).toBe(true);

    const checks = container.querySelectorAll(
      "[data-issue-select]",
    ) as NodeListOf<HTMLInputElement>;
    expect(checks.length).toBe(2);
    await fireEvent.click(checks[0]!);
    await fireEvent.click(checks[1]!);
    await tick();

    const toolbar = container.querySelector("[data-issues-bulk-toolbar]");
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute("data-selection-count")).toBe("2");

    const spawnAll = container.querySelector(
      "[data-issues-spawn-all]",
    ) as HTMLButtonElement;
    expect(spawnAll).not.toBeNull();
    await fireEvent.click(spawnAll);
    await tick();
    await tick();

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(2);
    const calls = spawnAgentInWorktreeMock.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ spawnedFromIssues: [21] });
    expect(calls[1]).toMatchObject({ spawnedFromIssues: [22] });
  });

  it("Spawn Together makes one call whose taskContext lists every selected issue and stamps all numbers", async () => {
    spawnAgentInWorktreeMock.mockClear();
    const fakeIssues = [
      {
        number: 31,
        title: "Alpha",
        state: "open",
        author: { login: "me" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/31",
      },
      {
        number: 32,
        title: "Beta",
        state: "open",
        author: { login: "me" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/32",
      },
      {
        number: 33,
        title: "Gamma",
        state: "open",
        author: { login: "me" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/33",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_issues") return fakeIssues;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: { api, component: Issues, props: {}, host: groupHost },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    const checks = container.querySelectorAll(
      "[data-issue-select]",
    ) as NodeListOf<HTMLInputElement>;
    await fireEvent.click(checks[0]!);
    await fireEvent.click(checks[2]!);
    await tick();

    const spawnTogether = container.querySelector(
      "[data-issues-spawn-together]",
    ) as HTMLButtonElement;
    expect(spawnTogether).not.toBeNull();
    expect(spawnTogether.disabled).toBe(false);
    await fireEvent.click(spawnTogether);
    await tick();
    await tick();

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(1);
    const arg = spawnAgentInWorktreeMock.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      spawnedFromIssues: [31, 33],
      branch: "agent/claude-code/together-31-33",
    });
    expect(arg.taskContext).toContain("Issue #31");
    expect(arg.taskContext).toContain("Issue #33");
    expect(arg.taskContext).toContain("Multi-issue task");
  });

  it("Spawn Together is disabled with a single selection", async () => {
    const fakeIssues = [
      {
        number: 41,
        title: "Solo",
        state: "open",
        author: { login: "me" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/41",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_issues") return fakeIssues;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });
    const { container } = render(ExtensionWrapper, {
      props: { api, component: Issues, props: {}, host: groupHost },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    const check = container.querySelector(
      "[data-issue-select]",
    ) as HTMLInputElement;
    await fireEvent.click(check);
    await tick();

    const together = container.querySelector(
      "[data-issues-spawn-together]",
    ) as HTMLButtonElement;
    expect(together.disabled).toBe(true);
  });

  it("renders a bot-icon jump button (no spawn group, no checkbox) when a workspace already handles the issue", async () => {
    switchSpy.mockReset();
    const fakeIssues = [
      {
        number: 51,
        title: "Already in flight",
        state: "open",
        author: { login: "me" },
        labels: [],
        created_at: "2026-04-19T00:00:00.000Z",
        url: "https://gh/51",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_issues") return fakeIssues;
      return undefined;
    });
    const api = makeApi({
      invoke: invokeFn,
      workspaces: [
        {
          id: "ws-handler",
          name: "agent: #51",
          metadata: { spawnedFromIssues: [51] },
        } as unknown as { id: string; name: string },
      ],
    });

    const { container } = render(ExtensionWrapper, {
      props: { api, component: Issues, props: {}, host: groupHost },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    expect(container.querySelector("[data-issue-spawn-group]")).toBeNull();
    expect(container.querySelector("[data-issue-spawn]")).toBeNull();
    expect(container.querySelector("[data-issue-select]")).toBeNull();

    const jump = container.querySelector(
      "[data-issue-jump]",
    ) as HTMLButtonElement;
    expect(jump).not.toBeNull();
    expect(jump.getAttribute("data-issue-handled-workspace")).toBe(
      "ws-handler",
    );
    await fireEvent.click(jump);
    await tick();

    expect(switchSpy).toHaveBeenCalledWith("ws-handler");
  });

  it("Refresh button shows 'Refreshing...' and is disabled while a fetch is in flight", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const inFlight = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_issues") return inFlight;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });
    const { container } = render(ExtensionWrapper, {
      props: { api, component: Issues, props: {}, host: groupHost },
    });

    // First fetch fires on mount, then awaits the gh_available probe
    // before setting `loading = true`. Pump several microtasks so the
    // gh_available promise resolves and the reactive update lands.
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      await tick();
    }

    const btn = container.querySelector(
      "[data-issues-refresh]",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("data-refreshing")).toBe("true");
    expect(btn.textContent?.trim()).toBe("Refreshing...");

    resolveFetch([]);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      await tick();
    }

    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("data-refreshing")).toBeNull();
    expect(btn.textContent?.trim()).toBe("Refresh");
  });
});

// --- Prs ---

describe("Prs widget", () => {
  const GROUP_ID = "grp-prs";
  const GROUP_PATH = "/work/proj";
  const groupHost = { metadata: { groupId: GROUP_ID } };

  beforeEach(async () => {
    configRef.current = {};
    saveConfigMock.mockClear();
    resetRegistry();
    invalidateGhAvailability();
    tauriInvokeGhAvailable.current = true;
    const { setWorkspaceGroups, resetWorkspaceGroupsForTest } =
      await import("../../../lib/stores/workspace-groups");
    resetWorkspaceGroupsForTest();
    setWorkspaceGroups([
      {
        id: GROUP_ID,
        name: "PRs Dash",
        path: GROUP_PATH,
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: [],
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders rows for PRs returned by gh_list_prs and never shows a spawn button", async () => {
    const fakePrs = [
      {
        number: 101,
        title: "Add login flow",
        state: "open",
        url: "https://gh/pr/101",
        headRefName: "feature/login",
        isDraft: false,
        author: { login: "octocat" },
        createdAt: "2026-04-19T00:00:00.000Z",
      },
      {
        number: 102,
        title: "WIP refactor",
        state: "open",
        url: "https://gh/pr/102",
        headRefName: "wip/refactor",
        isDraft: true,
        author: { login: "alxjrvs" },
        createdAt: "2026-04-19T00:00:00.000Z",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_prs") return fakePrs;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Prs,
        props: {},
        host: groupHost,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    const rows = container.querySelectorAll("[data-pr-row]");
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute("data-pr-number")).toBe("101");
    expect(container.querySelector("[data-pr-draft]")).not.toBeNull();
    // Read-only widget — no spawn button under any selector pattern.
    expect(container.querySelector("[data-pr-spawn]")).toBeNull();
    expect(container.querySelector("[data-issue-spawn]")).toBeNull();
  });

  it("clicking a row invokes open_url with the PR url", async () => {
    const fakePrs = [
      {
        number: 7,
        title: "Open me",
        state: "open",
        url: "https://gh/pr/7",
        headRefName: "branch-7",
        isDraft: false,
        author: { login: "me" },
        createdAt: "2026-04-19T00:00:00.000Z",
      },
    ];
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_prs") return fakePrs;
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Prs,
        props: {},
        host: groupHost,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    const row = container.querySelector("[data-pr-row]") as HTMLElement;
    expect(row).not.toBeNull();
    await fireEvent.click(row);
    await tick();

    expect(invokeFn).toHaveBeenCalledWith("open_url", {
      url: "https://gh/pr/7",
    });
  });

  it("renders the gh-missing panel when gh is not available", async () => {
    tauriInvokeGhAvailable.current = false;
    const invokeFn = vi.fn(async () => undefined);
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Prs,
        props: {},
        host: groupHost,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    const missing = container.querySelector("[data-prs-gh-missing]");
    expect(missing).not.toBeNull();
    expect(missing?.textContent).toContain("GitHub CLI not available");
    const retry = container.querySelector(
      "[data-prs-gh-missing-retry]",
    ) as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
  });

  it("renders the empty state when gh_list_prs returns no rows", async () => {
    const invokeFn = vi.fn(async (cmd: string) => {
      if (cmd === "gh_available") return true;
      if (cmd === "gh_list_prs") return [];
      return undefined;
    });
    const api = makeApi({ invoke: invokeFn });

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: Prs,
        props: {},
        host: groupHost,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await tick();

    expect(container.querySelector("[data-prs-empty]")).not.toBeNull();
    expect(container.querySelectorAll("[data-pr-row]").length).toBe(0);
  });
});

// --- AgentStatusRow ---

describe("AgentStatusRow widget", () => {
  beforeEach(async () => {
    configRef.current = {};
    saveConfigMock.mockClear();
    resetRegistry();
    switchSpy.mockReset();
    focusSpy.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the agent's status dot, name, and status label", async () => {
    const api = makeApi();
    registerAgent(makeAgent({ agentId: "a-1", status: "running" }));

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: AgentStatusRow,
        props: { agentId: "a-1" },
      },
    });

    await tick();

    const row = container.querySelector("[data-agent-status-row]");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-agent-id")).toBe("a-1");
    expect(container.querySelector("[data-status-dot]")).not.toBeNull();
    expect(
      container.querySelector("[data-agent-name]")?.textContent?.trim(),
    ).toBe("Claude Code");
    expect(
      container.querySelector("[data-agent-status]")?.textContent?.trim(),
    ).toBe("running");
  });

  it("clicking the row invokes switchWorkspace + focusSurface", async () => {
    const api = makeApi();
    registerAgent(
      makeAgent({
        agentId: "a-click",
        workspaceId: "ws-target",
        surfaceId: "surf-target",
      }),
    );

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: AgentStatusRow,
        props: { agentId: "a-click" },
      },
    });

    await tick();
    const row = container.querySelector(
      "[data-agent-status-row]",
    ) as HTMLElement;
    await fireEvent.click(row);
    expect(switchSpy).toHaveBeenCalledWith("ws-target");
    expect(focusSpy).toHaveBeenCalledWith("surf-target");
  });

  it("renders a missing-state placeholder when the agentId is unknown", async () => {
    const api = makeApi();

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: AgentStatusRow,
        props: { agentId: "nope" },
      },
    });

    await tick();
    expect(
      container.querySelector("[data-agent-status-row-missing]"),
    ).not.toBeNull();
  });
});

// --- AgentList ---

describe("AgentList widget", () => {
  beforeEach(async () => {
    configRef.current = {};
    saveConfigMock.mockClear();
    resetRegistry();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders one AgentStatusRow per agent (global scope)", async () => {
    const api = makeApi();
    registerAgent(makeAgent({ agentId: "a1", agentName: "Alpha" }));
    registerAgent(makeAgent({ agentId: "a2", agentName: "Bravo" }));
    registerAgent(makeAgent({ agentId: "a3", agentName: "Charlie" }));

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: AgentList,
        props: {},
        host: { metadata: { isGlobalAgenticDashboard: true } },
      },
    });

    await tick();
    const rows = container.querySelectorAll("[data-agent-status-row]");
    expect(rows.length).toBe(3);
    const names = Array.from(rows).map((r) =>
      r.querySelector("[data-agent-name]")?.textContent?.trim(),
    );
    expect(names).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("renders the empty-state when no agents are registered", async () => {
    const api = makeApi();

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: AgentList,
        props: {},
        host: { metadata: { isGlobalAgenticDashboard: true } },
      },
    });

    await tick();
    expect(container.querySelector("[data-agent-list-empty]")).not.toBeNull();
  });

  it("renders an inert 'no scope' panel when mounted without a dashboard host", async () => {
    const api = makeApi();
    registerAgent(makeAgent({ agentId: "a-ignored" }));

    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: AgentList,
        props: {},
      },
    });

    await tick();
    // No host → scope="none" → widget renders the empty state, not the
    // agent rows from the global store.
    expect(container.querySelectorAll("[data-agent-status-row]").length).toBe(
      0,
    );
    const list = container.querySelector("[data-agent-list]");
    expect(list?.getAttribute("data-scope-kind")).toBe("none");
  });
});

// --- TaskSpawner ---

describe("TaskSpawner widget", () => {
  const GROUP_ID = "grp-spawn";
  const GROUP_PATH = "/work/proj";
  const groupHost = { metadata: { groupId: GROUP_ID } };
  const globalHost = { metadata: { isGlobalAgenticDashboard: true } };

  beforeEach(async () => {
    configRef.current = {};
    saveConfigMock.mockClear();
    spawnAgentInWorktreeMock.mockClear();
    resetRegistry();
    const { setWorkspaceGroups, resetWorkspaceGroupsForTest } =
      await import("../../../lib/stores/workspace-groups");
    resetWorkspaceGroupsForTest();
    setWorkspaceGroups([
      {
        id: GROUP_ID,
        name: "Spawn Group",
        path: GROUP_PATH,
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: [],
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("starts collapsed and expands when '+ New Task' is clicked", async () => {
    const api = makeApi();
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: TaskSpawner,
        props: {},
        host: groupHost,
      },
    });

    expect(
      container.querySelector("[data-task-spawner-expand]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-task-spawner-form]")).toBeNull();

    const expandBtn = container.querySelector(
      "[data-task-spawner-expand]",
    ) as HTMLElement;
    await fireEvent.click(expandBtn);

    expect(container.querySelector("[data-task-spawner-form]")).not.toBeNull();
    expect(container.querySelector("[data-task-spawner-task]")).not.toBeNull();
  });

  it("agent picker default is claude-code", async () => {
    const api = makeApi();
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: TaskSpawner,
        props: {},
        host: groupHost,
      },
    });

    await fireEvent.click(
      container.querySelector("[data-task-spawner-expand]") as HTMLElement,
    );

    const agentBtn = container.querySelector(
      "[data-task-spawner-agent]",
    ) as HTMLElement;
    expect(agentBtn.textContent?.trim()).toBe("Claude Code");
  });

  it("Spawn button is disabled when task is empty and enabled once typed", async () => {
    const api = makeApi();
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: TaskSpawner,
        props: {},
        host: groupHost,
      },
    });

    await fireEvent.click(
      container.querySelector("[data-task-spawner-expand]") as HTMLElement,
    );

    const spawnBtn = container.querySelector(
      "[data-task-spawner-spawn]",
    ) as HTMLButtonElement;
    expect(spawnBtn.disabled).toBe(true);

    const textarea = container.querySelector(
      "[data-task-spawner-task]",
    ) as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "do the thing" } });

    expect(spawnBtn.disabled).toBe(false);
  });

  it("group scope → spawns with repoPath=group.path, groupId, spawnedBy={kind:'group'}", async () => {
    const api = makeApi();
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: TaskSpawner,
        props: {},
        host: groupHost,
      },
    });

    await fireEvent.click(
      container.querySelector("[data-task-spawner-expand]") as HTMLElement,
    );

    const textarea = container.querySelector(
      "[data-task-spawner-task]",
    ) as HTMLTextAreaElement;
    await fireEvent.input(textarea, {
      target: { value: "Refactor the thing" },
    });

    const spawnBtn = container.querySelector(
      "[data-task-spawner-spawn]",
    ) as HTMLButtonElement;
    await fireEvent.click(spawnBtn);

    await tick();
    await tick();

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(1);
    const callArg = spawnAgentInWorktreeMock.mock.calls[0]?.[0];
    expect(callArg).toMatchObject({
      agent: "claude-code",
      taskContext: "Refactor the thing",
      repoPath: GROUP_PATH,
      groupId: GROUP_ID,
      spawnedBy: { kind: "group", groupId: GROUP_ID },
      branch: "agent/claude-code/refactor-the-thing",
    });
    // Form collapses on success.
    expect(container.querySelector("[data-task-spawner-form]")).toBeNull();
    expect(
      container.querySelector("[data-task-spawner-expand]"),
    ).not.toBeNull();
  });

  it("global scope + repoPath config → spawns with spawnedBy={kind:'global'} and no groupId", async () => {
    const api = makeApi();
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: TaskSpawner,
        props: { repoPath: "/work/anywhere" },
        host: globalHost,
      },
    });

    await fireEvent.click(
      container.querySelector("[data-task-spawner-expand]") as HTMLElement,
    );

    const textarea = container.querySelector(
      "[data-task-spawner-task]",
    ) as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "Do global task" } });

    await fireEvent.click(
      container.querySelector("[data-task-spawner-spawn]") as HTMLElement,
    );
    await tick();
    await tick();

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(1);
    const callArg = spawnAgentInWorktreeMock.mock.calls[0]?.[0];
    expect(callArg).toMatchObject({
      repoPath: "/work/anywhere",
      spawnedBy: { kind: "global" },
    });
    expect(callArg.groupId).toBeUndefined();
  });

  it("no host / scope=none → spawn button stays disabled even with task text", async () => {
    const api = makeApi();
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: TaskSpawner,
        props: {},
      },
    });

    const host = container.querySelector("[data-task-spawner]");
    expect(host?.getAttribute("data-scope-kind")).toBe("none");

    await fireEvent.click(
      container.querySelector("[data-task-spawner-expand]") as HTMLElement,
    );
    const textarea = container.querySelector(
      "[data-task-spawner-task]",
    ) as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "anything" } });
    const spawnBtn = container.querySelector(
      "[data-task-spawner-spawn]",
    ) as HTMLButtonElement;
    expect(spawnBtn.disabled).toBe(true);
    expect(spawnAgentInWorktreeMock).not.toHaveBeenCalled();
  });

  it("Spawn surfaces the error and keeps the form expanded on failure", async () => {
    spawnAgentInWorktreeMock.mockRejectedValueOnce(new Error("worktree boom"));
    const api = makeApi();
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: TaskSpawner,
        props: {},
        host: groupHost,
      },
    });

    await fireEvent.click(
      container.querySelector("[data-task-spawner-expand]") as HTMLElement,
    );
    const textarea = container.querySelector(
      "[data-task-spawner-task]",
    ) as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "Some task" } });

    await fireEvent.click(
      container.querySelector("[data-task-spawner-spawn]") as HTMLElement,
    );
    await tick();
    await tick();

    const errEl = container.querySelector("[data-task-spawner-error]");
    expect(errEl?.textContent).toContain("worktree boom");
    expect(container.querySelector("[data-task-spawner-form]")).not.toBeNull();
  });

  it("Cancel collapses the form back to the button", async () => {
    const api = makeApi();
    const { container } = render(ExtensionWrapper, {
      props: {
        api,
        component: TaskSpawner,
        props: {},
        host: groupHost,
      },
    });

    await fireEvent.click(
      container.querySelector("[data-task-spawner-expand]") as HTMLElement,
    );
    await fireEvent.click(
      container.querySelector("[data-task-spawner-cancel]") as HTMLElement,
    );

    expect(container.querySelector("[data-task-spawner-form]")).toBeNull();
    expect(
      container.querySelector("[data-task-spawner-expand]"),
    ).not.toBeNull();
  });
});
