/**
 * Branch Lifecycle Service — barrel re-export.
 *
 * Implementation is split across:
 *   - branch-lifecycle-derive.ts  — pure derivation + types
 *   - branch-lifecycle-store.ts   — registry, store, sync, recompute, mutators
 *   - branch-lifecycle-actions.ts — user-driven transitions (markAbandoned)
 *
 * This barrel preserves the public import surface (`./branch-lifecycle`).
 */

export {
  isWipMessage,
  deriveLifecycle,
  type BranchLifecycle,
  type BranchLifecycleEntry,
  type PrState,
  type PrStateProvider,
  type DerivationInputs,
} from "./branch-lifecycle-derive";

export {
  branchLifecycleStore,
  initBranchLifecycle,
  destroyBranchLifecycle,
  resetBranchLifecycleForTests,
  updateBranchPrState,
  updateBranchCommitState,
  bumpBranchActivity,
  listBranchDescriptors,
  _testHelpers,
} from "./branch-lifecycle-store";

export { markAbandoned } from "./branch-lifecycle-actions";
