/**
 * Config schema migrations — versioned, forward-only transforms that
 * rewrite persisted `GnarTermConfig` shape as the project evolves.
 *
 * A migration runs exactly once per config: after it applies, the
 * config's `schemaVersion` records the highest migration it has seen.
 * Loaders call `runConfigMigrations` right after parsing; the scaffold
 * returns `{ changed }` so the loader can persist the migrated form.
 *
 * The ordered migration list lives in `./migrations/registry`. Tests
 * swap the registry via `vi.mock` to exercise this scaffold against
 * synthetic migration tables without touching production code.
 */
import type { GnarTermConfig } from "../config";
import { MIGRATIONS } from "./migrations/registry";

/**
 * Highest migration version known to this build. Configs that have run
 * through every migration land on this value. When MIGRATIONS is empty
 * this is 0 — fresh configs get stamped at 0 so future bumps can tell
 * "never migrated" from "migrated but on an older version."
 */
export const CURRENT_SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (acc, m) => Math.max(acc, m.version),
  0,
);

export interface ConfigMigrationResult {
  /** Config after applying every pending migration. */
  migrated: GnarTermConfig;
  /** True when either a migration ran or schemaVersion was stamped. */
  changed: boolean;
  /** Versions applied in this run, in order. */
  applied: number[];
}

/**
 * Apply every migration whose `version` is greater than the config's
 * current `schemaVersion`. Stamps `schemaVersion = CURRENT_SCHEMA_VERSION`
 * on the result.
 *
 * Returns the new config and a `changed` flag that is true when the
 * caller should persist the migrated form. `changed` is true when either
 * a migration ran OR the config lacked `schemaVersion` entirely (a fresh
 * or pre-scaffold config) — those still get a stamp so subsequent loads
 * skip this branch.
 */
export async function runConfigMigrations(
  config: GnarTermConfig,
): Promise<ConfigMigrationResult> {
  const startVersion = config.schemaVersion ?? 0;
  const hadVersion = typeof config.schemaVersion === "number";

  let current: GnarTermConfig = config;
  const applied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (migration.version > startVersion) {
      current = await migration.up(current);
      current = { ...current, schemaVersion: migration.version };
      applied.push(migration.version);
    }
  }

  if (applied.length === 0 && !hadVersion) {
    current = { ...current, schemaVersion: CURRENT_SCHEMA_VERSION };
  }

  const changed = applied.length > 0 || !hadVersion;
  return { migrated: current, changed, applied };
}
