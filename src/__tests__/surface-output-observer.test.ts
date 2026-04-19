import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addOutputObserver,
  removeOutputObserver,
  notifyOutputObservers,
  resetOutputObservers,
} from "../lib/services/surface-output-observer";

describe("surface-output-observer", () => {
  beforeEach(() => {
    resetOutputObservers();
  });

  it("notifies registered observers for matching ptyId", () => {
    const cb = vi.fn();
    addOutputObserver(42, cb);

    notifyOutputObservers(42, "hello");
    expect(cb).toHaveBeenCalledWith("hello");
  });

  it("does not notify observers for non-matching ptyId", () => {
    const cb = vi.fn();
    addOutputObserver(42, cb);

    notifyOutputObservers(99, "hello");
    expect(cb).not.toHaveBeenCalled();
  });

  it("supports multiple observers per ptyId", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    addOutputObserver(42, cb1);
    addOutputObserver(42, cb2);

    notifyOutputObservers(42, "data");
    expect(cb1).toHaveBeenCalledWith("data");
    expect(cb2).toHaveBeenCalledWith("data");
  });

  it("removes a specific observer", () => {
    const cb = vi.fn();
    addOutputObserver(42, cb);
    removeOutputObserver(42, cb);

    notifyOutputObservers(42, "data");
    expect(cb).not.toHaveBeenCalled();
  });

  it("handles errors in observers without breaking others", () => {
    const badCb = vi.fn(() => {
      throw new Error("boom");
    });
    const goodCb = vi.fn();
    addOutputObserver(42, badCb);
    addOutputObserver(42, goodCb);

    notifyOutputObservers(42, "data");
    expect(badCb).toHaveBeenCalled();
    expect(goodCb).toHaveBeenCalled();
  });
});
