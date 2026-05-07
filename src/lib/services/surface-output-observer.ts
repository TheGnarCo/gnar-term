/**
 * Surface Output Observer — fan-out PTY output to extension subscribers.
 *
 * Extensions with "observe" permission can subscribe to raw PTY output
 * for specific terminal surfaces. The terminal service calls
 * notifyOutputObservers() during its existing pty-output handler.
 *
 * Keyed by ptyId (not surfaceId) since that's how the terminal service
 * dispatches output. The extension API resolves surfaceId → ptyId.
 */

type OutputCallback = (data: string) => void;

const observers = new Map<number, Set<OutputCallback>>();

export function addOutputObserver(ptyId: number, cb: OutputCallback): void {
  let set = observers.get(ptyId);
  if (!set) {
    set = new Set();
    observers.set(ptyId, set);
  }
  set.add(cb);
}

export function removeOutputObserver(ptyId: number, cb: OutputCallback): void {
  const set = observers.get(ptyId);
  if (!set) return;
  set.delete(cb);
  if (set.size === 0) observers.delete(ptyId);
}

export function notifyOutputObservers(ptyId: number, data: string): void {
  const set = observers.get(ptyId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(data);
    } catch (e) {
      console.error("[surface-output-observer] Observer error:", e);
    }
  }
}

export function resetOutputObservers(): void {
  observers.clear();
}
