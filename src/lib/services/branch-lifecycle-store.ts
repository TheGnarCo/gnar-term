/**
 * branch-lifecycle-store — mutable branch registry + derived Readable store.
 *
 * Owns the per-branchId `BranchDescriptor` registry, the
 * `branchLifecycleStore` Readable, the recompute loop, and the
 * producer-side mutators (`updateBranchPrState`, `updateBranchCommitState`,
 * `bumpBranchActivity`) that passive observers call to feed real data into
 * the derivation.
 *
 * Pure derivation lives in `branch-lifecycle-derive.ts`; this module
 * resolves paneId → agent state (override map > live store), reads
 * gh-availability, and invokes `deriveLifecycle` per branch.
 */

import { writable, get, type Readable } from "svelte/store";
import { isGhAvailable } from "./gh-availability";
import { paneAgentStateStore } from "./agent-detection-service";
import { getConfig } from "../config";
import { isBranchedWorkspace, getAllPanes, type Workspace } from "../types";
import { workspaces } from "../stores/workspace";
import type { AgentState } from "./agent-state";
import { eventBus } from "./event-bus";
import {
  deriveLifecycle,
  type BranchLifecycleEntry,
  type DerivationInputs,
  type PrState,
  type PrStateProvider,
} from "./branch-lifecycle-derive";

// ---------------------------------------------------------------------------
// Test-only pane state override map. When a paneId is in this map,
// recomputeAll uses the override instead of reading from paneAgentStateStore.
// Cleared in `resetBranchLifecycleForTests` and `_testHelpers.clear`.
// ---------------------------------------------------------------------------
const _paneStateOverrides = new Map<string, AgentState>();

// ---------------------------------------------------------------------------
// Internal store
// ---------------------------------------------------------------------------

const _store = writable<Map<string, BranchLifecycleEntry>>(new Map());

export const branchLifecycleStore: Readable<Map<string, BranchLifecycleEntry>> =
  {
    subscribe: _store.subscribe,
  };

// ---------------------------------------------------------------------------
// Branch registry
// ---------------------------------------------------------------------------

interface BranchDescriptor {
  branchId: string;
  repoPath: string;
  branch: string;
  /** Base branch the worktree was forked from. Empty when unknown. */
  baseBranch: string;
  hasCommits: boolean;
  wipOnly: boolean;
  paneId: string | null;
  prState: PrState | null;
  lastActivityAt: number;
  workspaceId?: string;
}

let _branches: Map<string, BranchDescriptor> = new Map();
let _entryCache: Map<string, BranchLifecycleEntry> = new Map();

/** Internal accessor for the actions layer (markAbandoned). */
export function _getBranchDescriptor(
  branchId: string,
): BranchDescriptor | undefined {
  return _branches.get(branchId);
}

function getAbandonedAfterDays(): number {
  const raw = getConfig().agentDetection?.abandonedAfterDays;
  return typeof raw === "number" && raw > 0 ? raw : 14;
}

/**
 * Sync the `_branches` registry from the workspaces store. Each
 * BranchedWorkspace contributes one descriptor; descriptors for workspaces
 * that have since been removed are deleted.
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
    scheduleRecompute();
  }
}

/**
 * Fire-and-forget wrapper around recomputeAll(). Logs any rejection instead
 * of leaving the promise unhandled; lifecycle derivation calls gh + git so
 * a transient failure shouldn't crash the store but should still be visible.
 */
function scheduleRecompute(): void {
  recomputeAll().catch((err) => {
    console.error("[branch-lifecycle] recomputeAll failed:", err);
  });
}

async function recomputeAll(): Promise<void> {
  const ghAvailable = await isGhAvailable();
  const abandonedAfterDays = getAbandonedAfterDays();
  const stateMap = get(paneAgentStateStore);
  const next = new Map<string, BranchLifecycleEntry>();

  for (const [id, desc] of _branches) {
    const override = desc.paneId
      ? _paneStateOverrides.get(desc.paneId)
      : undefined;
    const live = desc.paneId ? stateMap.get(desc.paneId)?.state : undefined;
    // Override wins even when it isn't "running" — tests use this to force
    // non-running states without unmocking the live store.
    const paneAgentState: AgentState | undefined =
      override !== undefined ? override : live;

    const inputs: DerivationInputs = {
      hasCommits: desc.hasCommits,
      wipOnly: desc.wipOnly,
      paneId: desc.paneId,
      paneAgentState,
      prState: desc.prState,
      lastActivityAt: desc.lastActivityAt,
      ghAvailable,
      abandonedAfterDays,
    };
    const newEntry = deriveLifecycle(inputs);

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
 * Start the branch-lifecycle service. Idempotent — a second call tears down
 * the previous instance.
 *
 * @param prStateProvider — accepted for future extension; currently unused.
 */
export function initBranchLifecycle(prStateProvider?: PrStateProvider): void {
  if (_current) {
    _current.destroy();
    _current = null;
  }

  const cleanups: Array<() => void> = [];

  const unsubState = paneAgentStateStore.subscribe((stateMap) => {
    for (const desc of _branches.values()) {
      if (!desc.paneId) continue;
      const entry = stateMap.get(desc.paneId);
      if (!entry) continue;
      const t = Date.parse(entry.transitionedAt);
      if (Number.isFinite(t)) bumpBranchActivity(desc.branchId, t);
    }
    scheduleRecompute();
  });
  cleanups.push(unsubState);

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

  scheduleRecompute();
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
  scheduleRecompute();
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
  scheduleRecompute();
}

export function bumpBranchActivity(branchId: string, atMs?: number): void {
  const desc = _branches.get(branchId);
  if (!desc) return;
  const next = atMs ?? Date.now();
  if (next <= desc.lastActivityAt) return;
  desc.lastActivityAt = next;
  scheduleRecompute();
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
   * Inject an agent state for a pane, bypassing the full
   * agent-detection-service. Lets tests control the `active` lifecycle
   * derivation directly without unmocking the live store.
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
