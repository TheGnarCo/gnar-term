import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPoller } from "../lib/services/create-poller";

describe("createPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires an immediate tick on start by default", async () => {
    const tick = vi.fn(async () => {});
    const poller = createPoller({ intervalMs: 1000, tick });
    poller.start();
    await Promise.resolve();
    expect(tick).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("respects immediate: false", async () => {
    const tick = vi.fn(async () => {});
    const poller = createPoller({ intervalMs: 1000, tick, immediate: false });
    poller.start();
    await Promise.resolve();
    expect(tick).toHaveBeenCalledTimes(0);
    poller.stop();
  });

  it("ticks on each interval", async () => {
    const tick = vi.fn(async () => {});
    const poller = createPoller({
      intervalMs: 1000,
      tick,
      immediate: false,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("stop() prevents further ticks", async () => {
    const tick = vi.fn(async () => {});
    const poller = createPoller({
      intervalMs: 1000,
      tick,
      immediate: false,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    poller.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("start() is idempotent — clears prior interval", async () => {
    const tick = vi.fn(async () => {});
    const poller = createPoller({
      intervalMs: 1000,
      tick,
      immediate: false,
    });
    poller.start();
    poller.start(); // second start should not double-schedule
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("returned thunk acts as stop()", async () => {
    const tick = vi.fn(async () => {});
    const poller = createPoller({
      intervalMs: 1000,
      tick,
      immediate: false,
    });
    const dispose = poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("guards against re-entrant ticks while one is in-flight", async () => {
    let resolve: () => void = () => {};
    const tick = vi.fn(
      async () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const poller = createPoller({
      intervalMs: 1000,
      tick,
      immediate: false,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    // Second interval fires while the first tick is still pending — the
    // guarded tick should bail out instead of stacking.
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    // Once the first tick resolves, the next interval is free to fire.
    resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("tick errors are routed to onError and do not leave inFlight stuck", async () => {
    let calls = 0;
    const tick = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    });
    const onError = vi.fn();
    const poller = createPoller({
      intervalMs: 1000,
      tick,
      immediate: false,
      onError,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("stop() is safe when already stopped", () => {
    const tick = vi.fn(async () => {});
    const poller = createPoller({ intervalMs: 1000, tick });
    expect(() => poller.stop()).not.toThrow();
    expect(() => poller.stop()).not.toThrow();
  });
});
