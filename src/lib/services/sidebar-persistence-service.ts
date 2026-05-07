/**
 * Sidebar persistence — restores the primary sidebar's expanded /
 * collapsed state on launch and writes it back whenever the user toggles
 * it.
 *
 * Backed by `AppState.sidebarVisible` (config.ts). Without this service
 * the store always boots to `true` and the user's collapsed choice is
 * forgotten across launches.
 */
import { sidebarVisible } from "../stores/ui";
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
