/**
 * Lightweight global error reporting.
 *
 * WKWebView (macOS) and WebKitGTK (Linux) produce no user-retrievable crash
 * artifact, so uncaught exceptions and rejected promises previously vanished
 * silently. This module captures them to the console (with a stable tag) and a
 * bounded in-memory ring buffer that diagnostics or a future UI can read.
 *
 * It is deliberately dependency-free; swapping in a real crash reporter later
 * only requires changing `reportError`.
 */

export interface ReportedError {
  /** Epoch milliseconds when the error was captured. */
  time: number;
  /** Where the error came from (call site or handler name). */
  context: string;
  message: string;
  stack?: string;
}

const MAX_ERRORS = 100;
const recentErrors: ReportedError[] = [];

/** Capture an error to the console and the recent-errors ring buffer. */
export function reportError(error: unknown, context = "unknown"): void {
  const err = error instanceof Error ? error : new Error(String(error));
  recentErrors.push({
    time: Date.now(),
    context,
    message: err.message,
    stack: err.stack,
  });
  if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
  console.error(`[gnar-term:${context}]`, err);
}

/** The most recent captured errors (oldest first), capped at 100. */
export function getRecentErrors(): readonly ReportedError[] {
  return recentErrors;
}

let installed = false;

/**
 * Install window-level `error` and `unhandledrejection` listeners so otherwise
 * invisible failures land in the report buffer. Idempotent and a no-op outside
 * a browser/webview context (e.g. unit tests in node).
 */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, "window.onerror");
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, "unhandledrejection");
  });
}

/** Test-only: clear the ring buffer. */
export function _resetErrorReportingForTest(): void {
  recentErrors.length = 0;
}
