import { describe, it, expect } from "vitest";
import { RingBuffer } from "../lib/utils/ring-buffer";

describe("RingBuffer", () => {
  it("throws for capacity < 1", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(-1)).toThrow(RangeError);
  });

  it("starts empty", () => {
    const r = new RingBuffer<number>(4);
    expect(r.length).toBe(0);
    expect(r.toArray()).toEqual([]);
  });

  it("push items below capacity", () => {
    const r = new RingBuffer<number>(4);
    r.push(1);
    r.push(2);
    r.push(3);
    expect(r.length).toBe(3);
    expect(r.toArray()).toEqual([1, 2, 3]);
  });

  it("push items exactly at capacity", () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    r.push(3);
    expect(r.length).toBe(3);
    expect(r.toArray()).toEqual([1, 2, 3]);
  });

  it("overwrites oldest when full — length stays capped", () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    r.push(3);
    r.push(4); // evicts 1
    expect(r.length).toBe(3);
    expect(r.toArray()).toEqual([2, 3, 4]);
  });

  it("multiple overwrites preserve insertion order (oldest first)", () => {
    const r = new RingBuffer<number>(3);
    for (let i = 1; i <= 7; i++) r.push(i);
    // last 3 pushed: 5, 6, 7
    expect(r.toArray()).toEqual([5, 6, 7]);
  });

  it("toArray() returns a fresh array each call (no aliasing)", () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    const a = r.toArray();
    const b = r.toArray();
    expect(a).not.toBe(b);
    a[0] = 99;
    expect(r.toArray()[0]).toBe(1);
  });

  it("capacity=1 always holds only the last item", () => {
    const r = new RingBuffer<string>(1);
    r.push("a");
    r.push("b");
    r.push("c");
    expect(r.length).toBe(1);
    expect(r.toArray()).toEqual(["c"]);
  });
});
