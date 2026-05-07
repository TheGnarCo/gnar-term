/**
 * Cached probe for the GitHub CLI (`gh`) — so widgets that call into
 * `gh_list_issues` / `gh_list_prs` can skip doomed invokes and render an
 * actionable empty state instead of parsing error strings.
 *
 * The probe itself is a single `gh --version` call routed through the
 * Tauri `gh_available` command. First call triggers the probe; subsequent
 * calls return the cached result. `invalidateGhAvailability` clears the
 * cache so a UI retry button can force a re-probe after the user installs
 * or authenticates gh.
 */
import { invoke } from "@tauri-apps/api/core";

let cached: Promise<boolean> | null = null;

export function invalidateGhAvailability(): void {
  cached = null;
}

export function isGhAvailable(): Promise<boolean> {
  if (cached) return cached;
  cached = invoke<boolean>("gh_available")
    .then((ok) => Boolean(ok))
    .catch(() => false);
  return cached;
}
