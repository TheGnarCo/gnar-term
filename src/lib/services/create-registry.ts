/**
 * Generic registry factory — creates a store-backed registry with
 * register, unregister, unregisterBySource, get, and reset operations.
 *
 * Used by command-registry, sidebar-tab-registry, sidebar-section-registry,
 * and surface-type-registry to eliminate repeated boilerplate.
 */
import { writable, get, type Readable } from "svelte/store";

export interface RegistryItem {
  id: string;
  source: string;
}

export interface Registry<T extends RegistryItem> {
  register(item: T): void;
  unregister(id: string): void;
  unregisterBySource(source: string): void;
  get(id: string): T | undefined;
  reorder(fromIdx: number, toIdx: number): void;
  reset(): void;
  store: Readable<T[]>;
}

export function createRegistry<T extends RegistryItem>(): Registry<T> {
  const _store = writable<T[]>([]);

  return {
    register(item: T): void {
      _store.update((list) => {
        const idx = list.findIndex((i) => i.id === item.id);
        if (idx >= 0) {
          list[idx] = item;
          return [...list];
        }
        return [...list, item];
      });
    },

    unregister(id: string): void {
      _store.update((list) => list.filter((i) => i.id !== id));
    },

    unregisterBySource(source: string): void {
      _store.update((list) => list.filter((i) => i.source !== source));
    },

    get(id: string): T | undefined {
      return get(_store).find((i) => i.id === id);
    },

    reorder(fromIdx: number, toIdx: number): void {
      _store.update((list) => {
        const next = [...list];
        const [item] = next.splice(fromIdx, 1);
        const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
        next.splice(insertAt, 0, item);
        return next;
      });
    },

    reset(): void {
      _store.set([]);
    },

    store: _store as Readable<T[]>,
  };
}
