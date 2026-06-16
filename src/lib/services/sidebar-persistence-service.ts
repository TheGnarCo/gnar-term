/**
 * Sidebar persistence — restores the primary sidebar's expanded /
 * collapsed state and per-group collapsed flags on launch, then writes
 * them back whenever the user toggles either.
 *
 * Backed by `AppState.sidebarVisible` and `AppState.groupCollapsedById`
 * (config.ts). Any legacy dev-format state keys are normalized into the
 * canonical keys by `loadState` (see config.ts §5 legacy handling), so this
 * service only ever reads the canonical field. Without this service the stores
 * always
 * boot to their defaults and the user's choices are forgotten across
 * launches.
 */
import { sidebarVisible, groupCollapsedState } from "../stores/ui";
import { saveState, type AppState } from "../config";

/**
 * Apply the persisted boolean (if any) to the `sidebarVisible` store.
 * No-op when the field is absent so the store keeps its default of
 * `true` (expanded) for first-run users.
 */
export function restoreSidebarVisible(state: AppState): void {
  if (typeof state.sidebarVisible === "boolean") {
    sidebarVisible.set(state.sidebarVisible);
  }
}

/**
 * Subscribe to `sidebarVisible` and persist changes via `saveState`. The
 * very first emission (the current value at subscribe time) is skipped
 * so the just-restored value is not round-tripped back to disk. Returns
 * the unsubscribe function.
 *
 * Call AFTER `restoreSidebarVisible` so the skipped first emission is
 * the restored value, not the store's default.
 */
export function persistSidebarVisibleChanges(): () => void {
  let initialized = false;
  return sidebarVisible.subscribe((value) => {
    if (!initialized) {
      initialized = true;
      return;
    }
    void saveState({ sidebarVisible: value });
  });
}

/**
 * Hydrate `groupCollapsedState` from the persisted record. Entries are
 * stored as `Record<groupId, boolean>` on disk and reconstituted into
 * the in-memory Map. No-op when the field is absent so first-run users
 * fall through to the store's default-collapsed behavior.
 */
export function restoreGroupCollapsed(state: AppState): void {
  const record = state.groupCollapsedById;
  if (!record || typeof record !== "object") return;
  const map = new Map<string, boolean>();
  for (const [groupId, value] of Object.entries(record)) {
    if (typeof value === "boolean") map.set(groupId, value);
  }
  groupCollapsedState.set(map);
}

/**
 * Subscribe to `groupCollapsedState` and persist changes via
 * `saveState`. The first emission (the just-restored value) is skipped
 * so we don't round-trip the restore back to disk. Returns the
 * unsubscribe function.
 *
 * Call AFTER `restoreGroupCollapsed` for the same reason as the
 * sidebar-visible variant above.
 */
export function persistGroupCollapsedChanges(): () => void {
  let initialized = false;
  return groupCollapsedState.subscribe((map) => {
    if (!initialized) {
      initialized = true;
      return;
    }
    const record: Record<string, boolean> = {};
    for (const [groupId, value] of map) record[groupId] = value;
    void saveState({ groupCollapsedById: record });
  });
}
