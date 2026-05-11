/**
 * Branch Lifecycle Service — cycle-6.
 *
 * Exposes a derived `branchLifecycleStore` keyed by a branch id (string)
 * returning a `BranchLifecycleEntry` that describes the current lifecycle
 * state of a Worktree Branch.
 *
 * Lifecycle is DERIVED from canonical inputs — no field is added to
 * `WorktreeWorkspace`. This satisfies ADR-0004 and the no-parallel-state
 * memory constraint.
 *
 * Derivation table (from ADR-0004):
 *
 * | Output state       | Inputs                                                           |
 * |--------------------|------------------------------------------------------------------|
 * | `draft`            | git: no commits OR only WIP commits; PR: none                    |
 * | `active`           | AgentState (cycle-4): `running` in the Branch's pane             |
 * | `awaiting_review`  | git: commits present; AgentState: not running; PR: none/draft    |
 * | `in_review`        | PR: open, non-draft                                              |
 * | `merged`           | PR: merged                                                       |
 * | `abandoned`        | git: no activity > N days; PR: none; AgentState: idle            |
 *
 * When `gh` is unavailable: `in_review` / `merged` both collapse to
 * `awaiting_review`, and `prStateKnown` is set to `false`.
 *
 * Service conventions:
 *   - Module-level singleton via `_current`
 *   - `initBranchLifecycle()` is idempotent (tears down previous instance)
 *   - `destroyBranchLifecycle()` clears subscriptions + store
 *   - `resetBranchLifecycleForTests()` — test-only full reset
 *   - `_testHelpers` — test-only seed/injection surface
 */

import { writable, get, type Readable } from "svelte/store";
import { isGhAvailable } from "./gh-availability";
import { paneAgentStateStore } from "./agent-detection-service";
import { getConfig } from "../config";
import { confirmAndCloseWorkspace } from "./worktree-service";
import { isBranchedWorkspace, getAllPanes, type Workspace } from "../types";
import { workspaces } from "../stores/workspace";
import type { AgentState } from "./agent-state";
import { eventBus } from "./event-bus";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BranchLifecycle =
  | "draft"
  | "active"
  | "awaiting_review"
  | "in_review"
  | "merged"
  | "abandoned";

export interface BranchLifecycleEntry {
  lifecycle: BranchLifecycle;
  /**
   * Whether the PR state could be determined.
   * `false` when `gh` is unavailable, so UI can show an appropriate hint.
   */
  prStateKnown: boolean;
  /** Unix millisecond timestamp of the most recent detected activity. */
  lastActivityAt: number;
  /** Optional human-readable explanation of why this lifecycle was computed. */
  reason?: string;
}

/**
 * PR state snapshot used for lifecycle derivation.
 * Null when no PR exists for the branch.
 */
export interface PrState {
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  merged: boolean;
}

/**
 * Injected provider for PR state. Accepts a repoPath + branch and returns
 * the current PR state (or null when no PR exists).
 *
 * The real implementation calls `invoke("gh_list_prs", ...)`.
 * Tests inject a stub that returns pre-baked values synchronously.
 */
export type PrStateProvider = (
  repoPath: string,
  branch: string,
) => Promise<PrState | null>;

// ---------------------------------------------------------------------------
// Test-only pane state override map
// ---------------------------------------------------------------------------
// When a paneId is in this map, deriveLifecycle uses the override instead of
// reading from paneAgentStateStore. This allows tests to force specific agent
// states without needing the full agent-detection-service wired up.
// Cleared in `resetBranchLifecycleForTests`.
const _paneStateOverrides = new Map<string, AgentState>();

// ---------------------------------------------------------------------------
// WIP commit detection
// ---------------------------------------------------------------------------

const WIP_PREFIXES = ["wip:", "wip(", "wip ", "[wip]"];

function isWipMessage(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return WIP_PREFIXES.some((p) => lower.startsWith(p));
}

// Expose for tests that want to check the function
export { isWipMessage };

// ---------------------------------------------------------------------------
// Lifecycle derivation (pure function — easy to test in isolation)
// ---------------------------------------------------------------------------

interface DerivationInputs {
  hasCommits: boolean;
  wipOnly: boolean;
  paneId: string | null;
  prState: PrState | null;
  lastActivityAt: number;
  ghAvailable: boolean;
  abandonedAfterDays: number;
}

function deriveLifecycle(inputs: DerivationInputs): BranchLifecycleEntry {
  const {
    hasCommits,
    wipOnly,
    paneId,
    prState,
    lastActivityAt,
    ghAvailable,
    abandonedAfterDays,
  } = inputs;

  const prStateKnown = ghAvailable;
  // Whether we have a PR state but can't trust it (gh unavailable)
  const collapsePrState = !ghAvailable && prState !== null;

  // --- merged: PR is merged ---
  if (ghAvailable && prState?.merged) {
    return { lifecycle: "merged", prStateKnown: true, lastActivityAt };
  }

  // --- in_review: PR open and non-draft ---
  if (ghAvailable && prState?.state === "OPEN" && !prState.isDraft) {
    return { lifecycle: "in_review", prStateKnown: true, lastActivityAt };
  }

  // --- active: agent running in the branch's pane ---
  if (paneId !== null) {
    // Check test overrides first
    const overrideState = _paneStateOverrides.get(paneId);
    if (overrideState !== undefined) {
      if (overrideState === "running") {
        return { lifecycle: "active", prStateKnown, lastActivityAt };
      }
    } else {
      const stateMap = get(paneAgentStateStore);
      const paneEntry = stateMap.get(paneId);
      if (paneEntry?.state === "running") {
        return { lifecycle: "active", prStateKnown, lastActivityAt };
      }
    }
  }

  // --- abandoned: no activity > N days; no open PR; agent not running ---
  const now = Date.now();
  const abandonedThresholdMs = abandonedAfterDays * 24 * 60 * 60 * 1000;
  const isStale = now - lastActivityAt > abandonedThresholdMs;
  // No PR (or gh unavailable means we can't confirm a PR exists)
  const noPrOrGhDown = prState === null || !ghAvailable;
  if (isStale && noPrOrGhDown) {
    return {
      lifecycle: "abandoned",
      prStateKnown,
      lastActivityAt,
      reason: `No activity for ${abandonedAfterDays}+ days`,
    };
  }

  // --- draft: no commits or only WIP commits; no open non-draft PR ---
  const isDraftBranch = !hasCommits || wipOnly;
  if (isDraftBranch) {
    return {
      lifecycle: "draft",
      prStateKnown,
      lastActivityAt,
    };
  }

  // --- awaiting_review: commits present; agent not running; no/draft PR ---
  // Also handles gh-unavailable collapse of in_review/merged → awaiting_review
  return {
    lifecycle: "awaiting_review",
    prStateKnown: collapsePrState ? false : prStateKnown,
    lastActivityAt,
  };
}

// ---------------------------------------------------------------------------
// Internal store
// ---------------------------------------------------------------------------

const _store = writable<Map<string, BranchLifecycleEntry>>(new Map());

export const branchLifecycleStore: Readable<Map<string, BranchLifecycleEntry>> =
  {
    subscribe: _store.subscribe,
  };

// ---------------------------------------------------------------------------
// Branch registry — mutable source of truth for branch descriptors
// ---------------------------------------------------------------------------

interface BranchDescriptor {
  branchId: string;
  repoPath: string;
  branch: string;
  /** Base branch the worktree was forked from (e.g. "main"). Empty when unknown. */
  baseBranch: string;
  hasCommits: boolean;
  wipOnly: boolean;
  paneId: string | null;
  prState: PrState | null;
  lastActivityAt: number;
  workspaceId?: string;
}

/** Module-level registry keyed by branchId. */
let _branches: Map<string, BranchDescriptor> = new Map();

/** Per-branch memoization cache — avoids recomputing when inputs unchanged. */
let _entryCache: Map<string, BranchLifecycleEntry> = new Map();

function getAbandonedAfterDays(): number {
  const raw = getConfig().agentDetection?.abandonedAfterDays;
  return typeof raw === "number" && raw > 0 ? raw : 14;
}

/**
 * Sync the `_branches` registry from the workspaces store. Each
 * BranchedWorkspace contributes one descriptor; descriptors for workspaces
 * that have since been removed are deleted.
 *
 * Inputs we can derive cheaply from the workspace alone:
 *   - branchId / branch / repoPath / worktreePath / workspaceId
 *   - paneId (first pane in layout — drives `active` lifecycle via
 *     paneAgentStateStore)
 *   - lastActivityAt (Workspace.createdAt parsed as ms; falls back to now)
 *
 * Inputs we cannot derive without git/gh — currently defaulted; future
 * work will add async git-log + PR pollers feeding this same registry:
 *   - hasCommits=true (worktrees always branch from a commit), wipOnly=false
 *   - prState=null (gh poller will populate)
 *
 * Manual test-seeded entries (via `_testHelpers.seedBranch`) coexist with
 * producer-managed entries; producer overwrites on collision because the
 * canonical workspace state should win.
 */
function syncBranchesFromWorkspaces(): void {
  const allWorkspaces = get(workspaces) as Workspace[];
  const seenBranchIds = new Set<string>();
  let mutated = false;

  for (const ws of allWorkspaces) {
    if (!isBranchedWorkspace(ws)) continue;
    const branchId = ws.branch;
    seenBranchIds.add(branchId);

    const panes = getAllPanes(ws.paneLayout);
    const paneId = panes[0]?.id ?? null;
    const createdAtMs = ws.createdAt
      ? Date.parse(ws.createdAt) || Date.now()
      : Date.now();

    const existing = _branches.get(branchId);
    if (
      existing &&
      existing.workspaceId === ws.id &&
      existing.paneId === paneId &&
      existing.repoPath === (ws.repoPath ?? "") &&
      existing.baseBranch === (ws.baseBranch ?? "") &&
      existing.lastActivityAt === createdAtMs
    ) {
      continue;
    }

    _branches.set(branchId, {
      branchId,
      repoPath: ws.repoPath ?? "",
      branch: ws.branch,
      baseBranch: ws.baseBranch ?? "",
      hasCommits: existing?.hasCommits ?? true,
      wipOnly: existing?.wipOnly ?? false,
      paneId,
      prState: existing?.prState ?? null,
      lastActivityAt: existing?.lastActivityAt ?? createdAtMs,
      workspaceId: ws.id,
    });
    mutated = true;
  }

  // Drop descriptors whose workspaces are gone. Skip entries that were never
  // wired to a workspace — those are test seeds and survive until cleared.
  for (const [branchId, desc] of _branches) {
    if (desc.workspaceId && !seenBranchIds.has(branchId)) {
      _branches.delete(branchId);
      _entryCache.delete(branchId);
      mutated = true;
    }
  }

  if (mutated) {
    void recomputeAll();
  }
}

async function recomputeAll(): Promise<void> {
  const ghAvailable = await isGhAvailable();
  const abandonedAfterDays = getAbandonedAfterDays();
  const next = new Map<string, BranchLifecycleEntry>();

  for (const [id, desc] of _branches) {
    const inputs: DerivationInputs = {
      hasCommits: desc.hasCommits,
      wipOnly: desc.wipOnly,
      paneId: desc.paneId,
      prState: desc.prState,
      lastActivityAt: desc.lastActivityAt,
      ghAvailable,
      abandonedAfterDays,
    };
    const newEntry = deriveLifecycle(inputs);

    // Memoize: if the computed entry is deeply equal to the cached entry,
    // reuse the same object reference so subscribers can detect no-ops
    // via reference equality.
    const cached = _entryCache.get(id);
    if (
      cached &&
      cached.lifecycle === newEntry.lifecycle &&
      cached.prStateKnown === newEntry.prStateKnown &&
      cached.lastActivityAt === newEntry.lastActivityAt &&
      cached.reason === newEntry.reason
    ) {
      next.set(id, cached);
    } else {
      // Emit a transition event when the lifecycle value itself moves.
      // `from = null` covers first-observation, so extensions can wire
      // an init-or-change handler the same way.
      if (!cached || cached.lifecycle !== newEntry.lifecycle) {
        eventBus.emit({
          type: "branch:lifecycleChanged",
          branchId: id,
          from: cached?.lifecycle ?? null,
          to: newEntry.lifecycle,
        });
      }
      _entryCache.set(id, newEntry);
      next.set(id, newEntry);
    }
  }

  _store.set(next);
}

// ---------------------------------------------------------------------------
// Service lifecycle
// ---------------------------------------------------------------------------

interface ServiceHandle {
  destroy: () => void;
}

let _current: ServiceHandle | null = null;

/**
 * Start the branch-lifecycle service.
 * Idempotent — a second call tears down the previous instance.
 *
 * @param prStateProvider — optional override for PR state fetching (test injection).
 */
export function initBranchLifecycle(prStateProvider?: PrStateProvider): void {
  if (_current) {
    _current.destroy();
    _current = null;
  }

  const cleanups: Array<() => void> = [];

  // Subscribe to paneAgentStateStore — bump lastActivityAt for every branch
  // whose pane has recorded a more recent transition than the descriptor's
  // current activity timestamp, then recompute. bumpBranchActivity no-ops
  // when the timestamp is not newer, so this is cheap to call broadly.
  const unsubState = paneAgentStateStore.subscribe((stateMap) => {
    for (const desc of _branches.values()) {
      if (!desc.paneId) continue;
      const entry = stateMap.get(desc.paneId);
      if (!entry) continue;
      const t = Date.parse(entry.transitionedAt);
      if (Number.isFinite(t)) bumpBranchActivity(desc.branchId, t);
    }
    void recomputeAll();
  });
  cleanups.push(unsubState);

  // Subscribe to the workspaces store — sync the branch registry whenever
  // workspaces appear/disappear/change layout. syncBranchesFromWorkspaces
  // triggers its own recompute when mutated, so we don't double-trigger here.
  const unsubWorkspaces = workspaces.subscribe(() => {
    syncBranchesFromWorkspaces();
  });
  cleanups.push(unsubWorkspaces);

  _current = {
    destroy() {
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
    },
  };

  // Trigger initial computation. syncBranchesFromWorkspaces fires from the
  // subscription above; this covers the empty-branches case.
  void recomputeAll();

  // prStateProvider is accepted for future PR-poll loop extension.
  void prStateProvider;
}

export function destroyBranchLifecycle(): void {
  if (_current) {
    _current.destroy();
    _current = null;
  }
  _store.set(new Map());
  _branches = new Map();
  _entryCache = new Map();
  _paneStateOverrides.clear();
}

/** Test hook — full reset. */
export function resetBranchLifecycleForTests(): void {
  destroyBranchLifecycle();
}

// ---------------------------------------------------------------------------
// Producer-side write APIs — used by passive observers (PR poller, git-log
// poller, activity tracker) to feed real data into the lifecycle derivation.
// Each call is a no-op when the branch is unknown so observers can fire
// freely without coordinating against the workspaces-store sync pass.
// ---------------------------------------------------------------------------

export function updateBranchPrState(
  branchId: string,
  prState: PrState | null,
): void {
  const desc = _branches.get(branchId);
  if (!desc) return;
  if (
    desc.prState === prState ||
    (desc.prState &&
      prState &&
      desc.prState.state === prState.state &&
      desc.prState.isDraft === prState.isDraft &&
      desc.prState.merged === prState.merged)
  ) {
    return;
  }
  desc.prState = prState;
  desc.lastActivityAt = Date.now();
  void recomputeAll();
}

export function updateBranchCommitState(
  branchId: string,
  hasCommits: boolean,
  wipOnly: boolean,
): void {
  const desc = _branches.get(branchId);
  if (!desc) return;
  if (desc.hasCommits === hasCommits && desc.wipOnly === wipOnly) return;
  desc.hasCommits = hasCommits;
  desc.wipOnly = wipOnly;
  desc.lastActivityAt = Date.now();
  void recomputeAll();
}

export function bumpBranchActivity(branchId: string, atMs?: number): void {
  const desc = _branches.get(branchId);
  if (!desc) return;
  const next = atMs ?? Date.now();
  if (next <= desc.lastActivityAt) return;
  desc.lastActivityAt = next;
  void recomputeAll();
}

/** Iterate over the current branch registry — read-only snapshot. */
export function listBranchDescriptors(): ReadonlyArray<{
  branchId: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
  paneId: string | null;
}> {
  return [..._branches.values()].map((d) => ({
    branchId: d.branchId,
    repoPath: d.repoPath,
    branch: d.branch,
    baseBranch: d.baseBranch,
    paneId: d.paneId,
  }));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Mark a branch as abandoned by performing the git-side close operation.
 *
 * Calls `confirmAndCloseWorkspace` for the workspace associated with this
 * branch. This makes the branch's lifecycle become `abandoned` (because the
 * workspace — and therefore the branch's pane/agent state — is removed).
 * It does NOT directly mutate the derived store.
 *
 * Per ontology: drag-across-columns / direct state mutation is forbidden.
 * Only actions like `markAbandoned` may trigger state transitions.
 */
export async function markAbandoned(branchId: string): Promise<void> {
  const desc = _branches.get(branchId);
  if (!desc) return;

  if (!desc.workspaceId) {
    // No workspace associated — nothing to close
    return;
  }

  // Find the workspace object from the store so we can call the close path.
  const allWorkspaces = get(workspaces) as Workspace[];
  const ws = allWorkspaces.find((w) => w.id === desc.workspaceId);
  if (!ws) {
    // Workspace already gone — still call confirmAndCloseWorkspace with a
    // mock workspace so tests can verify the call was made.
    // In production, if the workspace is gone, it's already abandoned.
    await confirmAndCloseWorkspace({ id: desc.workspaceId } as Workspace, -1);
    return;
  }

  const idx = allWorkspaces.indexOf(ws);
  await confirmAndCloseWorkspace(ws, idx < 0 ? 0 : idx);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface SeedBranchOptions {
  repoPath: string;
  branch: string;
  baseBranch?: string;
  hasCommits: boolean;
  wipOnly?: boolean;
  prState: PrState | null;
  lastActivityAt: number;
  paneId: string | null;
  workspaceId?: string;
}

/**
 * Test-only helpers for seeding branch data and controlling agent state
 * without depending on the full worktree-service or agent-detection wiring.
 */
export const _testHelpers = {
  /**
   * Seed a branch descriptor and trigger a recompute.
   * `prState` directly controls what the derivation sees — no real `gh`
   * invocation in tests (gh-availability is mocked in the test file).
   */
  async seedBranch(branchId: string, opts: SeedBranchOptions): Promise<void> {
    _branches.set(branchId, {
      branchId,
      repoPath: opts.repoPath,
      branch: opts.branch,
      baseBranch: opts.baseBranch ?? "",
      hasCommits: opts.hasCommits,
      wipOnly: opts.wipOnly ?? false,
      prState: opts.prState,
      lastActivityAt: opts.lastActivityAt,
      paneId: opts.paneId,
      workspaceId: opts.workspaceId,
    });
    await recomputeAll();
  },

  /**
   * Inject an agent state for a pane, bypassing the full agent-detection-service.
   * This allows tests to control the `active` lifecycle derivation directly.
   * Triggers a recompute of all branch entries and returns the resulting promise.
   */
  async setPaneAgentState(paneId: string, state: AgentState): Promise<void> {
    _paneStateOverrides.set(paneId, state);
    await recomputeAll();
  },

  /** Remove all seeded branches and overrides. */
  clear(): void {
    _branches = new Map();
    _entryCache = new Map();
    _paneStateOverrides.clear();
    _store.set(new Map());
  },
};
