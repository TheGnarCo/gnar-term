/**
 * Generic registry factory — creates a store-backed registry with
 * register, unregister, unregisterBySource, get, and reset operations.
 *
 * Used by command-registry, sidebar-tab-registry, sidebar-section-registry,
 * surface-type-registry, theme-registry, claimed-workspace-registry, etc.
 * to eliminate repeated boilerplate.
 *
 * By default items are identified by a top-level `id` string field (the
 * `RegistryItem` contract). Pass `getId` to use a composite/derived
 * identity — e.g. sidebar-tab actions key on `tabId + actionId`, not a
 * single `id` field.
 */
import { writable, get, type Readable } from "svelte/store";

export interface RegistryItem {
  id: string;
  source: string;
}

export interface SourcedItem {
  source: string;
}

export interface CreateRegistryOptions<T> {
  /**
   * Identity function for items whose key isn't a single `id` field
   * (e.g. composite `${tabId}:${actionId}` keys). When omitted, items
   * must satisfy RegistryItem and identity derives from `item.id`.
   */
  getId?: (item: T) => string;
}

interface Registry<T extends SourcedItem> {
  register(item: T): void;
  unregister(id: string): void;
  unregisterBySource(source: string): void;
  get(id: string): T | undefined;
  reorder(fromIdx: number, toIdx: number): void;
  reset(): void;
  store: Readable<T[]>;
}

export function createRegistry<T extends RegistryItem>(): Registry<T>;
export function createRegistry<T extends SourcedItem>(
  options: CreateRegistryOptions<T> & { getId: (item: T) => string },
): Registry<T>;
export function createRegistry<T extends SourcedItem>(
  options: CreateRegistryOptions<T> = {},
): Registry<T> {
  const _store = writable<T[]>([]);
  const identify: (item: T) => string =
    options.getId ?? ((item) => (item as unknown as RegistryItem).id);

  return {
    register(item: T): void {
      const key = identify(item);
      _store.update((list) => {
        const idx = list.findIndex((i) => identify(i) === key);
        if (idx >= 0) {
          list[idx] = item;
          return [...list];
        }
        return [...list, item];
      });
    },

    unregister(id: string): void {
      _store.update((list) => list.filter((i) => identify(i) !== id));
    },

    unregisterBySource(source: string): void {
      _store.update((list) => list.filter((i) => i.source !== source));
    },

    get(id: string): T | undefined {
      return get(_store).find((i) => identify(i) === id);
    },

    reorder(fromIdx: number, toIdx: number): void {
      _store.update((list) => {
        if (
          fromIdx < 0 ||
          fromIdx >= list.length ||
          toIdx < 0 ||
          toIdx > list.length
        ) {
          return list;
        }
        const next = [...list];
        const [item] = next.splice(fromIdx, 1) as [T];
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
