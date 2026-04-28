import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { isMac } from "../terminal-service";

const _active = writable(false);

export const shortcutHintsActive: Readable<boolean> = {
  subscribe: _active.subscribe,
};

export function initShortcutHints(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const modKey = isMac ? "Meta" : "Control";

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === modKey) {
      if (e.repeat) return;
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          _active.set(true);
        }, 1000);
      }
    } else {
      clearTimer();
      _active.set(false);
    }
  }

  function handleKeyup(e: KeyboardEvent) {
    if (e.key === modKey) {
      clearTimer();
      _active.set(false);
    }
  }

  function handleBlur() {
    clearTimer();
    _active.set(false);
  }

  window.addEventListener("keydown", handleKeydown, true);
  window.addEventListener("keyup", handleKeyup, true);
  window.addEventListener("blur", handleBlur);

  return () => {
    clearTimer();
    _active.set(false);
    window.removeEventListener("keydown", handleKeydown, true);
    window.removeEventListener("keyup", handleKeyup, true);
    window.removeEventListener("blur", handleBlur);
  };
}
