/**
 * Restore-completion signal — waitRestored / markRestored / reset.
 *
 * This signal is the deferral mechanism extensions use when they need to
 * read or write the workspaces store but might race the bootstrap
 * `restoreWorkspaces` call. Pre-unification the equivalent flow was a
 * dedicated `open-preview` pendingAction; on the unified branch every
 * deferred consumer (e.g. an extension's auto-provision loop) goes
 * through `waitRestored()` instead, so this contract has become the
 * de-facto regression boundary the original test guarded.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  markRestored,
  waitRestored,
  resetRestoreSignal,
} from "../lib/bootstrap/restore-workspaces";

describe("restore signal", () => {
  beforeEach(() => {
    resetRestoreSignal();
  });

  it("waitRestored resolves immediately when already marked restored", async () => {
    markRestored();
    await expect(waitRestored()).resolves.toBeUndefined();
  });

  it("waitRestored defers until markRestored fires", async () => {
    let resolved = false;
    const waiter = waitRestored().then(() => {
      resolved = true;
    });

    // Yield to the microtask queue: still pending.
    await Promise.resolve();
    expect(resolved).toBe(false);

    markRestored();
    await waiter;
    expect(resolved).toBe(true);
  });

  it("multiple concurrent waiters all resolve on a single markRestored", async () => {
    const waiters = [waitRestored(), waitRestored(), waitRestored()];
    markRestored();
    await Promise.all(waiters);
    // No throw / hang means every waiter was released.
  });

  it("resetRestoreSignal forces subsequent waiters back to deferring", async () => {
    markRestored();
    await waitRestored(); // resolves immediately

    resetRestoreSignal();
    let resolved = false;
    const waiter = waitRestored().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    markRestored();
    await waiter;
    expect(resolved).toBe(true);
  });
});
