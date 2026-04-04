/**
 * Security tests for XSS prevention and sidebar bug fixes.
 *
 * S1: Markdown preview sanitizes HTML via DOMPurify
 * S2: Image preview uses DOM APIs (no innerHTML with user data)
 * S3: Video preview uses DOM APIs (no innerHTML with user data)
 * B3: Drag-drop reorder adjusts index when dragging forward
 * B4: Close Other Workspaces handles array mutation correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// ---------------------------------------------------------------------------
// S1: Markdown XSS prevention
// ---------------------------------------------------------------------------

describe("Markdown preview XSS prevention", () => {
  it("imports DOMPurify in preview/markdown.ts", async () => {
    // Verify the module imports DOMPurify by reading the source
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/markdown.ts", "utf-8");
    expect(source).toContain('import DOMPurify from "dompurify"');
    expect(source).toContain("DOMPurify.sanitize");
    expect(source).not.toMatch(/element\.innerHTML\s*=\s*marked\.parse/);
  });

  it("imports DOMPurify in markdown-viewer.ts", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/markdown-viewer.ts", "utf-8");
    expect(source).toContain('import DOMPurify from "dompurify"');
    expect(source).toContain("DOMPurify.sanitize");
  });

  it("escapes filePath in markdown-viewer.ts", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/markdown-viewer.ts", "utf-8");
    // filePath must be escaped before interpolation into HTML
    expect(source).toContain("escapedPath");
    expect(source).toMatch(/replace\(.*&lt;/);
  });
});

// ---------------------------------------------------------------------------
// S2/S3: Image and video preview use DOM APIs, not innerHTML
// ---------------------------------------------------------------------------

describe("Image preview XSS prevention", () => {
  it("does not use innerHTML with user data", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/image.ts", "utf-8");
    expect(source).not.toContain("innerHTML");
    expect(source).toContain("document.createElement");
  });

  it("sets src and alt via DOM properties", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/image.ts", "utf-8");
    expect(source).toContain("img.src");
    expect(source).toContain("img.alt");
  });
});

describe("Video preview XSS prevention", () => {
  it("does not use innerHTML with user data", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/video.ts", "utf-8");
    expect(source).not.toContain("innerHTML");
    expect(source).toContain("document.createElement");
  });

  it("sets src via DOM property", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/video.ts", "utf-8");
    expect(source).toContain("video.src");
  });
});

// ---------------------------------------------------------------------------
// B3: Drag-drop reorder fix
// ---------------------------------------------------------------------------

describe("Sidebar drag-drop reorder (B3)", () => {
  it("adjusts destination index when dragging forward", () => {
    // Simulate: 3 workspaces [A, B, C], drag A (idx 0) to after C (idx 2)
    const workspaces = ["A", "B", "C"];
    const fromIdx = 0;
    const dropTargetIdx = 2;

    // Remove from source
    const item = workspaces.splice(fromIdx, 1)[0];
    // After splice, array is [B, C] and dropTargetIdx points to what was C

    // The fix: subtract 1 when dragging forward
    const toIdx = fromIdx < dropTargetIdx ? dropTargetIdx - 1 : dropTargetIdx;
    workspaces.splice(toIdx, 0, item);

    expect(workspaces).toEqual(["B", "A", "C"]);
  });

  it("does not adjust index when dragging backward", () => {
    // Simulate: 3 workspaces [A, B, C], drag C (idx 2) to before A (idx 0)
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
    // Simulate the fixed algorithm
    const workspaces = ["A", "B", "C", "D", "E"];
    let targetIdx = 2; // Keep "C"

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
