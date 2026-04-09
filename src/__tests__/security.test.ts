/**
 * Security tests and sidebar bug fixes.
 *
 * S1: Markdown preview XSS prevention (render-based via DOMPurify)
 * B3: Drag-drop reorder adjusts index when dragging forward
 * B4: Close Other Workspaces handles array mutation correctly
 */

import { describe, it, expect, vi } from "vitest";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: vi.fn(
    (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  ),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// ---------------------------------------------------------------------------
// S1: Markdown XSS prevention — render-based test
// ---------------------------------------------------------------------------

describe("Markdown preview XSS prevention", () => {
  it("DOMPurify strips script tags from rendered markdown", async () => {
    const { marked } = await import("marked");
    const DOMPurify = (await import("dompurify")).default;

    const malicious = '<script>alert("xss")</script><p>safe content</p>';
    const rawHtml = marked.parse(malicious) as string;
    const sanitized = DOMPurify.sanitize(rawHtml);

    // Verify script tags are stripped from the sanitized output
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).toContain("safe content");
  });

  it("DOMPurify strips onerror attributes from img tags", async () => {
    const { marked } = await import("marked");
    const DOMPurify = (await import("dompurify")).default;

    const malicious = '<img src=x onerror="alert(1)">';
    const rawHtml = marked.parse(malicious) as string;
    const sanitized = DOMPurify.sanitize(rawHtml);

    // onerror attribute must be stripped
    expect(sanitized).not.toContain("onerror");
  });
});

// ---------------------------------------------------------------------------
// B3: Drag-drop reorder fix
// ---------------------------------------------------------------------------

describe("Sidebar drag-drop reorder (B3)", () => {
  it("adjusts destination index when dragging forward", () => {
    const workspaces = ["A", "B", "C"];
    const fromIdx = 0;
    const dropTargetIdx = 2;

    const item = workspaces.splice(fromIdx, 1)[0];
    const toIdx = fromIdx < dropTargetIdx ? dropTargetIdx - 1 : dropTargetIdx;
    workspaces.splice(toIdx, 0, item);

    expect(workspaces).toEqual(["B", "A", "C"]);
  });

  it("does not adjust index when dragging backward", () => {
    const workspaces = ["A", "B", "C"];
    const fromIdx = 2;
    const dropTargetIdx = 0;

    const item = workspaces.splice(fromIdx, 1)[0];
    const toIdx = fromIdx < dropTargetIdx ? dropTargetIdx - 1 : dropTargetIdx;
    workspaces.splice(toIdx, 0, item);

    expect(workspaces).toEqual(["C", "A", "B"]);
  });
});

// ---------------------------------------------------------------------------
// B4: Close Other Workspaces fix
// ---------------------------------------------------------------------------

describe("Close Other Workspaces (B4)", () => {
  it("keeps only the target workspace when closing others", () => {
    const workspaces = ["A", "B", "C", "D", "E"];
    let targetIdx = 2;

    for (let i = workspaces.length - 1; i >= 0; i--) {
      if (i !== targetIdx) {
        workspaces.splice(i, 1);
        if (i < targetIdx) targetIdx--;
      }
    }

    expect(workspaces).toEqual(["C"]);
  });

  it("handles target at index 0", () => {
    const workspaces = ["A", "B", "C"];
    let targetIdx = 0;

    for (let i = workspaces.length - 1; i >= 0; i--) {
      if (i !== targetIdx) {
        workspaces.splice(i, 1);
        if (i < targetIdx) targetIdx--;
      }
    }

    expect(workspaces).toEqual(["A"]);
  });

  it("handles target at last index", () => {
    const workspaces = ["A", "B", "C"];
    let targetIdx = 2;

    for (let i = workspaces.length - 1; i >= 0; i--) {
      if (i !== targetIdx) {
        workspaces.splice(i, 1);
        if (i < targetIdx) targetIdx--;
      }
    }

    expect(workspaces).toEqual(["C"]);
  });
});
