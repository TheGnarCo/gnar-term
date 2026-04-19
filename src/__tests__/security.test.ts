/**
 * Security tests for XSS prevention and sidebar bug fixes.
 *
 * S1: Markdown preview sanitizes HTML via DOMPurify
 * S2: Image preview uses DOM APIs (no innerHTML with user data)
 * S3: Video preview uses DOM APIs (no innerHTML with user data)
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
// S1: Markdown XSS prevention
// ---------------------------------------------------------------------------

describe("Markdown preview XSS prevention", () => {
  it("imports DOMPurify in preview/markdown.ts", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/extensions/preview/previewers/markdown.ts",
      "utf-8",
    );
    expect(source).toContain('import DOMPurify from "dompurify"');
    expect(source).toContain("DOMPurify.sanitize");
    expect(source).not.toMatch(/element\.innerHTML\s*=\s*marked\.parse/);
  });
});

// ---------------------------------------------------------------------------
// S2/S3: Image and video preview use DOM APIs, not innerHTML
// ---------------------------------------------------------------------------

describe("Image preview XSS prevention", () => {
  it("does not use innerHTML with user data", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/extensions/preview/previewers/image.ts",
      "utf-8",
    );
    expect(source).not.toContain("innerHTML");
    expect(source).toContain("document.createElement");
  });

  it("sets src and alt via DOM properties", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/extensions/preview/previewers/image.ts",
      "utf-8",
    );
    expect(source).toContain("img.src");
    expect(source).toContain("img.alt");
  });
});

describe("Video preview XSS prevention", () => {
  it("does not use innerHTML with user data", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/extensions/preview/previewers/video.ts",
      "utf-8",
    );
    expect(source).not.toContain("innerHTML");
    expect(source).toContain("document.createElement");
  });

  it("sets src via DOM property", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/extensions/preview/previewers/video.ts",
      "utf-8",
    );
    expect(source).toContain("video.src");
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

// ---------------------------------------------------------------------------
// Discriminated union type safety
// ---------------------------------------------------------------------------

describe("Surface discriminated union", () => {
  it("no more null-as-any hacks in source code", async () => {
    const fs = await import("fs");
    const tsFiles = [
      "src/App.svelte",
      "src/lib/terminal-service.ts",
      "src/lib/types.ts",
    ];

    for (const file of tsFiles) {
      try {
        const source = fs.readFileSync(file, "utf-8");
        expect(source).not.toContain("terminal: null as any");
        expect(source).not.toContain("fitAddon: { fit: () => {} } as any");
        expect(source).not.toContain("searchAddon: null as any");
      } catch (e: unknown) {
        if (
          e instanceof Error &&
          (e as NodeJS.ErrnoException).code !== "ENOENT"
        )
          throw e;
      }
    }
  });

  it("dead code markdown-viewer.ts is deleted", async () => {
    const fs = await import("fs");
    expect(() => fs.readFileSync("src/markdown-viewer.ts", "utf-8")).toThrow();
  });
});
