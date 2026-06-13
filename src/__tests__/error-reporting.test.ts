import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  reportError,
  getRecentErrors,
  installGlobalErrorHandlers,
  _resetErrorReportingForTest,
} from "../lib/services/error-reporting";

describe("error-reporting", () => {
  beforeEach(() => {
    _resetErrorReportingForTest();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("captures an Error with its message, stack, and context", () => {
    reportError(new Error("boom"), "test-ctx");
    const errors = getRecentErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("boom");
    expect(errors[0].context).toBe("test-ctx");
    expect(errors[0].stack).toBeTruthy();
    expect(typeof errors[0].time).toBe("number");
  });

  it("coerces non-Error values into an Error message", () => {
    reportError("just a string");
    expect(getRecentErrors()[0].message).toBe("just a string");
    expect(getRecentErrors()[0].context).toBe("unknown");
  });

  it("caps the ring buffer at 100 entries, dropping the oldest", () => {
    for (let i = 0; i < 150; i++) reportError(new Error(`e${i}`), "loop");
    const errors = getRecentErrors();
    expect(errors).toHaveLength(100);
    // Oldest 50 evicted → first retained is e50, last is e149.
    expect(errors[0].message).toBe("e50");
    expect(errors[errors.length - 1].message).toBe("e149");
  });

  it("routes uncaught errors and unhandled rejections into the buffer", () => {
    installGlobalErrorHandlers();
    installGlobalErrorHandlers(); // idempotent — must not double-register

    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("uncaught"), message: "uncaught" }),
    );
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("rejected");
    window.dispatchEvent(rejection);

    const messages = getRecentErrors().map((e) => e.message);
    expect(messages).toContain("uncaught");
    expect(messages).toContain("rejected");
    // Idempotency: each event captured exactly once.
    expect(messages.filter((m) => m === "uncaught")).toHaveLength(1);
  });
});
