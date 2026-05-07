/**
 * Preview pipeline behavioral coverage.
 *
 * Pre-unification this suite lived as `preview-coverage.test.ts` and covered
 * the previewer registry + openPreview behavior end-to-end. The branch
 * deleted the file alongside the directory rename (src/preview → src/lib/
 * preview) without porting it. This file restores the contract assertions:
 *
 *   - Registry: canPreview / getSupportedExtensions / findPreviewer
 *   - openPreview: throws for unknown extensions, calls read_file for text
 *     types and skips it for binary types, sets up a watch_file handle for
 *     text types only, returns a PreviewResult with all required fields
 *   - Per-previewer rendering basics (JSON XSS escape, image/video element
 *     creation, text/csv structured output)
 *
 * Per-previewer rendering details for markdown live in
 * markdown-previewer-components.test.ts. PDF rendering is intentionally not
 * covered here — it requires EmbedPDF mocking and adds little regression
 * value for the unification work.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// --- Mocks (must be set before imports that reach Tauri) ---

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../lib/stores/theme", () => {
  const themeValue = {
    bg: "#000",
    fg: "#fff",
    fgDim: "#888",
    bgSurface: "#111",
    bgHighlight: "#222",
    border: "#333",
    ansi: {
      blue: "#00f",
      green: "#0f0",
      magenta: "#f0f",
      yellow: "#ff0",
      red: "#f00",
      cyan: "#0ff",
      white: "#fff",
      black: "#000",
    },
  };
  return {
    theme: {
      subscribe: (fn: (v: typeof themeValue) => void) => {
        fn(themeValue);
        return () => {};
      },
    },
  };
});

import { invoke } from "@tauri-apps/api/core";
import {
  canPreview,
  getSupportedExtensions,
  findPreviewer,
  clearPreviewers,
} from "../lib/services/preview-registry";
import { openPreview } from "../lib/services/preview-service";

// Force every previewer to register before any test runs. Importing for side
// effects mirrors the production bootstrap path (src/lib/preview/init.ts).
beforeAll(async () => {
  clearPreviewers();
  await import("../lib/preview/previewers/json");
  await import("../lib/preview/previewers/text");
  await import("../lib/preview/previewers/csv");
  await import("../lib/preview/previewers/yaml");
  await import("../lib/preview/previewers/image");
  await import("../lib/preview/previewers/video");
  await import("../lib/preview/previewers/markdown");
  await import("../lib/preview/previewers/pdf");
});

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

// ─── Registry ─────────────────────────────────────────────────────

describe("preview registry", () => {
  it("canPreview returns true for every registered extension", () => {
    const exts = [
      "pdf",
      "md",
      "json",
      "png",
      "jpg",
      "mp4",
      "csv",
      "tsv",
      "yaml",
      "yml",
      "toml",
      "txt",
      "log",
      "webm",
      "gif",
    ];
    for (const ext of exts) {
      expect(canPreview(`anywhere/file.${ext}`), ext).toBe(true);
    }
  });

  it("canPreview returns false for unregistered extensions", () => {
    expect(canPreview("file.exe")).toBe(false);
    expect(canPreview("file.zip")).toBe(false);
    expect(canPreview("file.dmg")).toBe(false);
  });

  it("getSupportedExtensions enumerates every registered extension", () => {
    const exts = getSupportedExtensions();
    for (const ext of [
      "pdf",
      "md",
      "json",
      "png",
      "csv",
      "mp4",
      "txt",
      "yaml",
    ]) {
      expect(exts).toContain(ext);
    }
  });

  it("findPreviewer returns undefined for unknown extensions", () => {
    expect(findPreviewer("file.unknown-ext-xyz")).toBeUndefined();
  });
});

// ─── openPreview pipeline ─────────────────────────────────────────

describe("openPreview", () => {
  it("throws for unregistered extensions", async () => {
    await expect(openPreview("/tmp/file.exe")).rejects.toThrow(
      "No previewer registered for .exe",
    );
  });

  it("calls read_file for text types", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return '{"key": "value"}';
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/test.json");
    expect(mockInvoke).toHaveBeenCalledWith("read_file", {
      path: "/tmp/test.json",
    });
    expect(result.filePath).toBe("/tmp/test.json");
    expect(result.title).toBe("test.json");
    expect(result.element).toBeInstanceOf(HTMLElement);
  });

  it("does NOT call read_file for binary types", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await openPreview("/tmp/test.png");
    const reads = mockInvoke.mock.calls.filter(([cmd]) => cmd === "read_file");
    expect(reads).toHaveLength(0);
  });

  it("sets up a watch_file handle for text types", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "hello";
      if (cmd === "watch_file") return 42;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/test.txt");
    expect(mockInvoke).toHaveBeenCalledWith("watch_file", {
      path: "/tmp/test.txt",
    });
    expect(result.watchId).toBe(42);
  });

  it("does NOT set up a watch for binary types", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await openPreview("/tmp/test.png");
    const watches = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === "watch_file",
    );
    expect(watches).toHaveLength(0);
    expect(result.watchId).toBe(0);
  });

  it("returns a PreviewResult with all required fields", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "# Hello";
      if (cmd === "watch_file") return 7;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/readme.md");
    expect(result.id).toMatch(/^preview-/);
    expect(result.filePath).toBe("/tmp/readme.md");
    expect(result.title).toBe("readme.md");
    expect(result.element).toBeInstanceOf(HTMLDivElement);
    expect(result.watchId).toBe(7);
  });

  it("renders an inline error when read_file fails", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") throw new Error("boom");
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/missing.txt");
    expect(result.element.textContent).toContain("Error reading file");
    expect(result.element.textContent).toContain("boom");
  });
});

// ─── JSON previewer ───────────────────────────────────────────────

describe("JSON previewer", () => {
  it("renders valid JSON with syntax highlighting classes", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file")
        return '{"name": "x", "n": 1, "ok": true, "z": null}';
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/data.json");
    const html = result.element.innerHTML;
    expect(html).toContain("<pre>");
    expect(html).toContain("<code>");
    expect(html).toContain('class="json-key"');
    expect(html).toContain('class="json-string"');
    expect(html).toContain('class="json-number"');
    expect(html).toContain('class="json-boolean"');
    expect(html).toContain('class="json-null"');
  });

  it("renders invalid JSON as plain text without crashing", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "{not valid json: ???}";
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/bad.json");
    expect(result.element.textContent).toContain("{not valid json: ???}");
    expect(result.element.innerHTML).toContain("<pre>");
  });

  it("escapes HTML in JSON to prevent XSS", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return '{"xss": "<img onerror=alert(1) src=x>"}';
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/xss.json");
    const html = result.element.innerHTML;
    // The literal img tag must not appear unescaped
    expect(html).not.toMatch(/<img\s+onerror/i);
    expect(html).toContain("&lt;img");
  });
});

// ─── Image previewer ──────────────────────────────────────────────

describe("Image previewer", () => {
  it("creates an img element pointed at convertFileSrc(path)", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await openPreview("/tmp/photo.png");
    const img = result.element.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.src).toContain("/tmp/photo.png");
  });
});

// ─── Video previewer ──────────────────────────────────────────────

describe("Video previewer", () => {
  it("creates a video element pointed at convertFileSrc(path)", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await openPreview("/tmp/clip.mp4");
    const video = result.element.querySelector("video");
    expect(video).not.toBeNull();
    expect(video!.src).toContain("/tmp/clip.mp4");
  });
});

// ─── Text previewer ───────────────────────────────────────────────

describe("Text previewer", () => {
  it("renders text with line numbers", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "first\nsecond\nthird";
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/notes.txt");
    expect(result.element.textContent).toContain("first");
    expect(result.element.textContent).toContain("second");
    expect(result.element.textContent).toContain("third");
    // Line numbers prefix the lines
    expect(result.element.textContent).toContain("1");
    expect(result.element.textContent).toContain("2");
    expect(result.element.textContent).toContain("3");
  });

  it("escapes HTML in text content", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "<script>alert(1)</script>";
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/evil.txt");
    expect(result.element.innerHTML).not.toContain("<script>alert(1)</script>");
    expect(result.element.innerHTML).toContain("&lt;script&gt;");
  });
});

// ─── CSV previewer ────────────────────────────────────────────────

describe("CSV previewer", () => {
  it("renders rows in a table", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "name,age\nalice,30\nbob,25";
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/people.csv");
    const table = result.element.querySelector("table");
    expect(table).not.toBeNull();
    expect(result.element.textContent).toContain("alice");
    expect(result.element.textContent).toContain("bob");
  });
});

// ─── YAML/TOML previewer ──────────────────────────────────────────

describe("YAML/TOML previewer", () => {
  it("renders YAML content in a pre/code block", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "name: gnar\nport: 8080";
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/config.yaml");
    expect(result.element.innerHTML).toMatch(/<pre|<code/);
    expect(result.element.textContent).toContain("name: gnar");
    expect(result.element.textContent).toContain("port: 8080");
  });

  it("renders TOML through the same previewer", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return 'title = "x"\nport = 80';
      if (cmd === "watch_file") return 1;
      return undefined as unknown;
    });
    const result = await openPreview("/tmp/Config.toml");
    expect(result.element.textContent).toContain("title");
    expect(result.element.textContent).toContain("port");
  });
});
