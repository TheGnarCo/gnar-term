/**
 * Per-surface PTY-ready signalling.
 *
 * connectPty() resolves the deferred once the Rust spawn_pty call returns;
 * waitForPtyReady() awaits it instead of polling surface.ptyId every 50ms. The
 * polling version created a 50ms timer storm during spawn bursts that
 * contributed to a compositor freeze.
 */
import type { TerminalSurface } from "../types";

interface PtyReadyDeferred {
  promise: Promise<number>;
  resolve: (ptyId: number) => void;
  reject: (err: Error) => void;
}

/** Per-surface deferred keyed by surface.id. Shared between waitForPtyReady()
 *  (which creates/awaits) and connectPty() (which resolves/rejects). */
export const ptyReady = new Map<string, PtyReadyDeferred>();

function makeDeferred(): PtyReadyDeferred {
  let resolve!: (n: number) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<number>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function waitForPtyReady(surface: TerminalSurface, timeoutMs = 5000): Promise<number> {
  if (surface.ptyId >= 0) return Promise.resolve(surface.ptyId);
  let d = ptyReady.get(surface.id);
  if (!d) {
    d = makeDeferred();
    ptyReady.set(surface.id, d);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timed out waiting for PTY to spawn"));
    }, timeoutMs);
    d!.promise.then(
      (n) => {
        clearTimeout(timer);
        resolve(n);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
