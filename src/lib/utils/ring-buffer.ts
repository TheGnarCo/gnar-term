/**
 * O(1) fixed-capacity ring buffer. When full, push() overwrites the oldest
 * entry in place rather than shifting the underlying array.
 */
export class RingBuffer<T> {
  private readonly _buf: (T | undefined)[];
  private _head = 0; // index of the oldest item (valid when _length > 0)
  private _length = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) throw new RangeError("RingBuffer capacity must be >= 1");
    this.capacity = capacity;
    this._buf = new Array<T | undefined>(capacity).fill(undefined);
  }

  /** Append an item. When the buffer is full the oldest item is overwritten. */
  push(item: T): void {
    if (this._length < this.capacity) {
      // Still filling — write at the next slot after the current tail.
      const tail = (this._head + this._length) % this.capacity;
      this._buf[tail] = item;
      this._length++;
    } else {
      // Full — overwrite the oldest slot and advance head.
      this._buf[this._head] = item;
      this._head = (this._head + 1) % this.capacity;
    }
  }

  /** Number of items currently stored. */
  get length(): number {
    return this._length;
  }

  /**
   * Return all items in insertion order (oldest first).
   * Allocates a new array on each call — callers should cache the result
   * when iterating multiple times over the same snapshot.
   */
  toArray(): T[] {
    if (this._length === 0) return [];
    const out: T[] = new Array<T>(this._length);
    for (let i = 0; i < this._length; i++) {
      out[i] = this._buf[(this._head + i) % this.capacity] as T;
    }
    return out;
  }
}
