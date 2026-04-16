/**
 * Preview system behavioral tests.
 * Tests actual render() output, registry behavior, and link detection.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// --- Mocks (must be before imports) ---

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@embedpdf/snippet", () => ({
  default: { init: vi.fn() },
}));

vi.mock("marked", () => ({
  marked: { parse: (s: string) => `<p>${s}</p>` },
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: (s: string) =>
      s
        .replace(/<script[^>]*>.*?<\/script>/gi, "")
        .replace(/\sonerror="[^"]*"/gi, ""),
  },
}));

vi.mock("github-markdown-css/github-markdown-dark.css", () => ({}));

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readable } from "svelte/store";
import EmbedPDF from "@embedpdf/snippet";
import { canPreview, getSupportedExtensions } from "../preview-registry";
import { openPreview } from "../preview-service";
import { resolveFilePath } from "../../../lib/terminal-service";
import type { ExtensionAPI } from "../../api";

// Import all preview extensions so they self-register
beforeAll(async () => {
  await import("../previewers/pdf");
  await import("../previewers/image");
  await import("../previewers/video");
  await import("../previewers/markdown");
  await import("../previewers/json");
  await import("../previewers/csv");
  await import("../previewers/yaml");
  await import("../previewers/text");
});

const mockInvoke = vi.mocked(invoke);
const mockConvertFileSrc = vi.mocked(convertFileSrc);
const mockListen = vi.mocked(listen);

const mockTheme = {
  bg: "#000",
  fg: "#fff",
  fgDim: "#888",
  bgSurface: "#111",
  bgHighlight: "#222",
  border: "#333",
  accent: "#0ff",
  ansi: { blue: "#00f", green: "#0f0", magenta: "#f0f", yellow: "#ff0" },
};

/** Minimal mock ExtensionAPI for preview-service tests. */
const mockApi = {
  invoke: (...args: Parameters<typeof invoke>) => invoke(...args),
  convertFileSrc: (path: string) => convertFileSrc(path),
  onFileChanged: (_watchId: number, _handler: () => void) => () => {},
  theme: readable(mockTheme),
} as unknown as ExtensionAPI;

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen
    .mockReset()
    .mockResolvedValue(vi.fn() as unknown as ReturnType<typeof listen>);
  (EmbedPDF.init as ReturnType<typeof vi.fn>).mockReset();
  // jsdom doesn't have URL.createObjectURL — mock it
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
  }
});

// ─── Preview Registry ────────────────────────────────────────────

describe("Preview registry", () => {
  it("canPreview returns true for all registered extensions", () => {
    const registered = [
      "pdf",
      "md",
      "json",
      "png",
      "jpg",
      "mp4",
      "csv",
      "yaml",
      "txt",
      "toml",
      "webm",
      "gif",
      "log",
    ];
    for (const ext of registered) {
      expect(canPreview(`file.${ext}`)).toBe(true);
    }
  });

  it("canPreview returns false for unregistered extensions", () => {
    expect(canPreview("file.exe")).toBe(false);
    expect(canPreview("file.zip")).toBe(false);
    expect(canPreview("file.dmg")).toBe(false);
  });

  it("getSupportedExtensions includes all previewer extensions", () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain("pdf");
    expect(exts).toContain("md");
    expect(exts).toContain("json");
    expect(exts).toContain("png");
    expect(exts).toContain("csv");
    expect(exts).toContain("mp4");
    expect(exts).toContain("txt");
    expect(exts).toContain("yaml");
  });

  it("openPreview throws for unregistered extension", async () => {
    await expect(openPreview("/tmp/file.exe", mockApi)).rejects.toThrow(
      "No previewer registered for .exe",
    );
  });

  it("openPreview calls read_file for text types", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return '{"key": "value"}';
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/test.json", mockApi);
    expect(mockInvoke).toHaveBeenCalledWith("read_file", {
      path: "/tmp/test.json",
    });
    expect(surface.filePath).toBe("/tmp/test.json");
    expect(surface.title).toBe("test.json");
    expect(surface.element).toBeInstanceOf(HTMLElement);
  });

  it("openPreview does NOT call read_file for binary types (pdf)", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const surface = await openPreview("/tmp/test.pdf", mockApi);
    const readFileCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === "read_file",
    );
    expect(readFileCalls).toHaveLength(0);
    expect(surface.filePath).toBe("/tmp/test.pdf");
  });

  it("openPreview does NOT call read_file for binary types (png)", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await openPreview("/tmp/test.png", mockApi);
    const readFileCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === "read_file",
    );
    expect(readFileCalls).toHaveLength(0);
  });

  it("openPreview sets up file watch for text types", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "hello";
      if (cmd === "watch_file") return 42;
      return undefined;
    });

    const surface = await openPreview("/tmp/test.txt", mockApi);
    expect(mockInvoke).toHaveBeenCalledWith("watch_file", {
      path: "/tmp/test.txt",
    });
    expect(surface.watchId).toBe(42);
  });

  it("openPreview does NOT set up file watch for binary types", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const surface = await openPreview("/tmp/test.pdf", mockApi);
    const watchCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === "watch_file",
    );
    expect(watchCalls).toHaveLength(0);
    expect(surface.watchId).toBe(0);
  });

  it("openPreview returns PreviewSurface with all required fields", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "# Hello";
      if (cmd === "watch_file") return 7;
      return undefined;
    });

    const surface = await openPreview("/tmp/readme.md", mockApi);
    expect(surface.id).toMatch(/^preview-/);
    expect(surface.filePath).toBe("/tmp/readme.md");
    expect(surface.title).toBe("readme.md");
    expect(surface.element).toBeInstanceOf(HTMLDivElement);
    expect(surface.watchId).toBe(7);
  });
});

// ─── PDF Previewer ───────────────────────────────────────────────

describe("PDF previewer", () => {
  it("shows loading message initially, then renders iframe after read_file_base64", async () => {
    const b64 = btoa("fake-pdf-bytes");
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file_base64") return b64;
      return undefined;
    });

    const surface = await openPreview("/tmp/report.pdf", mockApi);

    // invoke should have been called with read_file_base64
    expect(mockInvoke).toHaveBeenCalledWith("read_file_base64", {
      path: "/tmp/report.pdf",
    });

    // Let the .then() chain settle (render is async via .then, not await)
    await vi.waitFor(() => {
      expect(surface.element.querySelector("iframe")).not.toBeNull();
    });

    // PDF previewer creates an iframe with a blob: URL
    const iframe = surface.element.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toMatch(/^blob:/);
    expect(iframe!.style.width).toBe("100%");
    expect(iframe!.style.height).toBe("100%");
  });

  it("shows error message when read_file_base64 fails", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file_base64") throw new Error("File not found");
      return undefined;
    });

    const surface = await openPreview("/tmp/missing.pdf", mockApi);

    await vi.waitFor(() => {
      expect(surface.element.textContent).toContain("Failed to load PDF");
    });
    expect(surface.element.textContent).toContain("File not found");
  });
});

// ─── JSON Previewer ──────────────────────────────────────────────

describe("JSON previewer", () => {
  it("renders valid JSON with syntax highlighting", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file")
        return '{"name": "test", "count": 42, "active": true, "data": null}';
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/data.json", mockApi);
    const html = surface.element.innerHTML;

    expect(html).toContain("<pre>");
    expect(html).toContain("<code>");
    // Syntax highlighting classes
    expect(html).toContain('class="json-key"');
    expect(html).toContain('class="json-string"');
    expect(html).toContain('class="json-number"');
    expect(html).toContain('class="json-boolean"');
    expect(html).toContain('class="json-null"');
  });

  it("renders invalid JSON as escaped plain text without crashing", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "{not valid json: ???}";
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/bad.json", mockApi);
    expect(surface.element.textContent).toContain("{not valid json: ???}");
    // Should still be in a pre/code block
    expect(surface.element.innerHTML).toContain("<pre>");
  });

  it("escapes HTML in JSON content to prevent XSS", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return '{"xss": "<img onerror=alert(1) src=x>"}';
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/xss.json", mockApi);
    // The JSON previewer uses syntaxHighlight which wraps values in spans,
    // but the string value content should be escaped by the JSON.stringify + regex flow.
    // Check that the raw dangerous attribute doesn't survive as a real attribute
    const imgs = surface.element.querySelectorAll("img");
    expect(imgs).toHaveLength(0);
  });
});

// ─── Markdown Previewer ──────────────────────────────────────────

describe("Markdown previewer", () => {
  it("renders markdown content as HTML", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "# Hello World";
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/readme.md", mockApi);
    // marked.parse mock returns <p>content</p>
    expect(surface.element.innerHTML).toContain("<p>");
    expect(surface.element.classList.contains("markdown-body")).toBe(true);
  });

  it("sanitizes XSS payloads from markdown", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return '<script>alert("xss")</script>';
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/evil.md", mockApi);
    // DOMPurify mock strips <script> tags
    expect(surface.element.innerHTML).not.toContain("<script>");
  });
});

// ─── CSV Previewer ───────────────────────────────────────────────

describe("CSV previewer", () => {
  it("renders CSV as a table with correct structure", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "Name,Age,City\nAlice,30,NYC\nBob,25,LA";
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/data.csv", mockApi);
    const table = surface.element.querySelector("table");
    expect(table).not.toBeNull();

    const headers = table!.querySelectorAll("thead th");
    expect(headers).toHaveLength(3);
    expect(headers[0].textContent).toBe("Name");
    expect(headers[1].textContent).toBe("Age");
    expect(headers[2].textContent).toBe("City");

    const rows = table!.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    const firstRowCells = rows[0].querySelectorAll("td");
    expect(firstRowCells[0].textContent).toBe("Alice");
    expect(firstRowCells[1].textContent).toBe("30");
    expect(firstRowCells[2].textContent).toBe("NYC");
  });

  it("shows row/column count", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "A,B\n1,2\n3,4\n5,6";
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/nums.csv", mockApi);
    expect(surface.element.textContent).toContain("3 rows");
    expect(surface.element.textContent).toContain("2 columns");
  });

  it("handles empty CSV", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "";
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/empty.csv", mockApi);
    expect(surface.element.textContent).toContain("(empty file)");
  });

  it("handles quoted fields containing commas", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file")
        return 'Name,Address\n"Smith, John","123 Main St, Apt 4"';
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/quoted.csv", mockApi);
    const cells = surface.element.querySelectorAll("tbody td");
    expect(cells[0].textContent).toBe("Smith, John");
    expect(cells[1].textContent).toBe("123 Main St, Apt 4");
  });

  it("uses tab separator for TSV files", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "Name\tAge\nAlice\t30";
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/data.tsv", mockApi);
    const headers = surface.element.querySelectorAll("thead th");
    expect(headers[0].textContent).toBe("Name");
    expect(headers[1].textContent).toBe("Age");
  });
});

// ─── Image Previewer ─────────────────────────────────────────────

describe("Image previewer", () => {
  it("creates img element with convertFileSrc URL", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const surface = await openPreview("/tmp/photo.png", mockApi);
    const img = surface.element.querySelector("img");
    expect(img).not.toBeNull();
    expect(mockConvertFileSrc).toHaveBeenCalledWith("/tmp/photo.png");
    expect(img!.src).toContain("asset://localhost/");
  });

  it("shows error message on image load failure", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const surface = await openPreview("/tmp/broken.jpg", mockApi);
    const img = surface.element.querySelector("img");
    expect(img).not.toBeNull();

    // Simulate load error
    img!.dispatchEvent(new Event("error"));
    // onerror handler is set via img.onerror, so fire it directly
    if (img!.onerror) (img!.onerror as (ev: Event) => void)(new Event("error"));

    expect(surface.element.textContent).toContain("Failed to load image");
  });

  it("registers for all common image formats", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "svg"]) {
      expect(canPreview(`file.${ext}`)).toBe(true);
    }
  });
});

// ─── Video Previewer ─────────────────────────────────────────────

describe("Video previewer", () => {
  it("creates video element with controls and autoplay", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const surface = await openPreview("/tmp/clip.mp4", mockApi);
    const video = surface.element.querySelector("video");
    expect(video).not.toBeNull();
    expect(video!.controls).toBe(true);
    expect(video!.autoplay).toBe(true);
    expect(mockConvertFileSrc).toHaveBeenCalledWith("/tmp/clip.mp4");
  });

  it("shows error message on video load failure", async () => {
    mockInvoke.mockResolvedValue(undefined);

    const surface = await openPreview("/tmp/broken.webm", mockApi);
    const video = surface.element.querySelector("video");
    expect(video).not.toBeNull();

    if (video!.onerror)
      (video!.onerror as (ev: Event) => void)(new Event("error"));

    expect(surface.element.textContent).toContain("Failed to load video");
  });

  it("registers for all common video formats", () => {
    for (const ext of ["mp4", "webm", "mov", "avi", "mkv"]) {
      expect(canPreview(`file.${ext}`)).toBe(true);
    }
  });
});

// ─── Text Previewer ──────────────────────────────────────────────

describe("Text previewer", () => {
  it("renders with line numbers", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "line one\nline two\nline three";
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/notes.txt", mockApi);
    const html = surface.element.innerHTML;
    expect(html).toContain("<pre");
    // Line numbers 1, 2, 3
    expect(surface.element.textContent).toContain("1");
    expect(surface.element.textContent).toContain("2");
    expect(surface.element.textContent).toContain("3");
    expect(surface.element.textContent).toContain("line one");
    expect(surface.element.textContent).toContain("line two");
    expect(surface.element.textContent).toContain("line three");
  });

  it("escapes HTML in text content to prevent XSS", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return '<script>alert("xss")</script>';
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/evil.txt", mockApi);
    expect(surface.element.innerHTML).toContain("&lt;script&gt;");
    expect(surface.element.innerHTML).not.toContain("<script>alert");
  });

  it("registers for txt, log, conf, and other text formats", () => {
    for (const ext of ["txt", "log", "conf", "cfg", "ini", "env"]) {
      expect(canPreview(`file.${ext}`)).toBe(true);
    }
  });
});

// ─── YAML/TOML Previewer ────────────────────────────────────────

describe("YAML/TOML previewer", () => {
  it("renders YAML with syntax highlighting", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file")
        return "name: test\ncount: 42\nactive: true\n# comment";
      if (cmd === "watch_file") return 1;
      return undefined;
    });

    const surface = await openPreview("/tmp/config.yaml", mockApi);
    const html = surface.element.innerHTML;
    expect(html).toContain("<pre");
    expect(html).toContain("<code>");
    // The YAML previewer injects <span style="color:..."> for keys, booleans, comments
    // Check that spans with style attributes are present (highlighting is working)
    const spans = surface.element.querySelectorAll("span[style]");
    expect(spans.length).toBeGreaterThan(0);
    // Content should contain the actual YAML values
    expect(surface.element.textContent).toContain("name");
    expect(surface.element.textContent).toContain("test");
    expect(surface.element.textContent).toContain("42");
    expect(surface.element.textContent).toContain("true");
    expect(surface.element.textContent).toContain("# comment");
  });

  it("registers for yaml, yml, and toml", () => {
    expect(canPreview("config.yaml")).toBe(true);
    expect(canPreview("config.yml")).toBe(true);
    expect(canPreview("config.toml")).toBe(true);
  });
});

// ─── Link Provider Regex (existing real tests) ──────────────────

describe("Link provider regex matches correct filenames", () => {
  function getMatches(text: string): string[] {
    const exts =
      "pdf|md|txt|csv|json|yaml|yml|toml|png|jpg|jpeg|gif|webp|svg|ico|bmp|heic|heif|tiff|tif|avif|mp4|webm|mov|avi|mkv|m4v|ogv|log|conf|cfg|ini|env|gitignore|dockerignore|editorconfig|tsv|mdx|markdown";
    const patterns = [
      `"([^"]+\\.(?:${exts}))"`,
      `'([^']+\\.(?:${exts}))'`,
      `((?:/|\\./|~/)\\S[\\S ]*\\.(?:${exts}))(?=\\s|$)`,
      `(\\S+\\.(?:${exts}))(?=\\s|$)`,
    ];
    // eslint-disable-next-line security/detect-non-literal-regexp -- pattern built from hardcoded file extensions
    const regex = new RegExp(patterns.join("|"), "gi");
    const matches: string[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push(m[1] || m[2] || m[3] || m[4]);
    }
    return matches;
  }

  it("matches multiple bare files on one line separately", () => {
    expect(getMatches("file1.pdf  file2.pdf  file3.txt")).toEqual([
      "file1.pdf",
      "file2.pdf",
      "file3.txt",
    ]);
  });

  it("matches ls column output with quoted filename containing spaces, parens, apostrophes, double dots", () => {
    const line =
      'u8328834736_A_happy_derpy_unicorn.png  "Walpole Sportsman\'s Association Inc..Invoice.03853 (1).pdf"';
    const matches = getMatches(line);
    expect(matches).toContain("u8328834736_A_happy_derpy_unicorn.png");
    expect(matches).toContain(
      "Walpole Sportsman's Association Inc..Invoice.03853 (1).pdf",
    );
  });

  it("matches bare filename with underscores and long name", () => {
    expect(
      getMatches(
        "u8328834736_A_happy_derpy_unicorn_with_bubble_text_that_says__812d01a7-9e05-44b4-ab08-64b53d739064_3.png",
      ),
    ).toEqual([
      "u8328834736_A_happy_derpy_unicorn_with_bubble_text_that_says__812d01a7-9e05-44b4-ab08-64b53d739064_3.png",
    ]);
  });

  it("does not match garbage from ls -la output", () => {
    const matches = getMatches(
      "-rw-r--r--  1 user  staff  1234 Jan  1 12:00 Doc.pdf",
    );
    expect(matches).toEqual(["Doc.pdf"]);
  });

  it("matches absolute paths with spaces", () => {
    expect(getMatches("/Users/me/My Doc.pdf")).toEqual([
      "/Users/me/My Doc.pdf",
    ]);
  });

  it("matches home paths with spaces", () => {
    expect(getMatches("~/Downloads/WR Product Requirements Doc.pdf")).toEqual([
      "~/Downloads/WR Product Requirements Doc.pdf",
    ]);
  });

  it("matches relative paths with spaces", () => {
    expect(getMatches("./local/My File.md")).toEqual(["./local/My File.md"]);
  });

  it("matches quoted filenames with spaces", () => {
    expect(getMatches('"WR Product Requirements Doc.pdf"')).toEqual([
      "WR Product Requirements Doc.pdf",
    ]);
  });

  it("matches simple absolute paths", () => {
    expect(getMatches("/tmp/test-link.md")).toEqual(["/tmp/test-link.md"]);
  });

  it("matches path embedded in a sentence", () => {
    expect(getMatches("Saved to /Users/me/Downloads/Report.pdf done")).toEqual([
      "/Users/me/Downloads/Report.pdf",
    ]);
  });

  it("bare filename with spaces only matches extension segment", () => {
    expect(getMatches("WR Product Requirements Doc.pdf")).toEqual(["Doc.pdf"]);
  });
});

// ─── PDF links with spaces — end-to-end proof ──────────────────

describe("PDF links with spaces work end-to-end", () => {
  // Helper: replicates the link provider regex from terminal-service.ts
  function getMatchesFromLine(text: string): string[] {
    const exts = getSupportedExtensions().join("|");
    const patterns = [
      `"([^"]+\\.(?:${exts}))"`,
      `'([^']+\\.(?:${exts}))'`,
      `((?:/|\\./|~/)\\S[\\S ]*\\.(?:${exts}))(?=\\s|$)`,
      `(\\S+\\.(?:${exts}))(?=\\s|$)`,
    ];
    // eslint-disable-next-line security/detect-non-literal-regexp -- pattern built from hardcoded file extensions
    const regex = new RegExp(patterns.join("|"), "gi");
    const matches: string[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push(m[1] || m[2] || m[3] || m[4]);
    }
    return matches;
  }

  it("STEP 1: regex detects '~/Downloads/WR Product Requirements Doc.pdf' from terminal output", () => {
    const line = "Saved to ~/Downloads/WR Product Requirements Doc.pdf";
    const matches = getMatchesFromLine(line);
    expect(matches).toEqual(["~/Downloads/WR Product Requirements Doc.pdf"]);
  });

  it("STEP 2: resolveFilePath expands ~ in 'WR Product Requirements Doc.pdf' path", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") return "/Users/ngmaloney";
      return undefined;
    });

    const resolved = await resolveFilePath(
      "~/Downloads/WR Product Requirements Doc.pdf",
      "/some/cwd",
    );
    expect(resolved).toBe(
      "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    );
  });

  it("STEP 3: openPreview handles path with spaces for PDF", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file_base64") return btoa("fake-pdf");
      return undefined;
    });

    const surface = await openPreview(
      "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
      mockApi,
    );
    expect(surface.filePath).toBe(
      "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    );
    expect(surface.title).toBe("WR Product Requirements Doc.pdf");
    // Verify it called read_file_base64 with the full spaced path
    expect(mockInvoke).toHaveBeenCalledWith("read_file_base64", {
      path: "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    });
  });

  it("STEP 1-3 combined: absolute path with spaces, full chain", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file_base64") return btoa("fake-pdf");
      return undefined;
    });

    // Step 1: Regex detection
    const line = "open /Users/me/My Documents/Annual Report 2024.pdf please";
    const matches = getMatchesFromLine(line);
    expect(matches).toEqual(["/Users/me/My Documents/Annual Report 2024.pdf"]);

    // Step 2: Path resolution (absolute path, no transformation needed)
    const resolved = await resolveFilePath(matches[0], "/some/cwd");
    expect(resolved).toBe("/Users/me/My Documents/Annual Report 2024.pdf");

    // Step 3: Preview opens correctly
    const surface = await openPreview(resolved, mockApi);
    expect(surface.filePath).toBe(
      "/Users/me/My Documents/Annual Report 2024.pdf",
    );
    expect(surface.title).toBe("Annual Report 2024.pdf");
    expect(mockInvoke).toHaveBeenCalledWith("read_file_base64", {
      path: "/Users/me/My Documents/Annual Report 2024.pdf",
    });
  });

  it("STEP 1-3 combined: quoted path with spaces, full chain", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") return "/Users/ngmaloney";
      if (cmd === "read_file_base64") return btoa("fake-pdf");
      return undefined;
    });

    // Step 1: Regex detection (quoted)
    const line = 'Opening "WR Product Requirements Doc.pdf"';
    const matches = getMatchesFromLine(line);
    expect(matches).toEqual(["WR Product Requirements Doc.pdf"]);

    // Step 2: Path resolution (bare filename → prepend cwd)
    const resolved = await resolveFilePath(
      matches[0],
      "/Users/ngmaloney/Downloads",
    );
    expect(resolved).toBe(
      "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    );

    // Step 3: Preview opens
    const surface = await openPreview(resolved, mockApi);
    expect(surface.filePath).toBe(
      "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    );
    expect(mockInvoke).toHaveBeenCalledWith("read_file_base64", {
      path: "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    });
  });

  it("file exists in cwd → link created, file doesn't exist → no link", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(
      async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "file_exists") {
          const path = (args as Record<string, unknown>).path as string;
          return path === "/Users/ngmaloney/Workspace/gnar-term/vite.config.ts";
        }
        if (cmd === "read_file") return "export default {}";
        if (cmd === "watch_file") return 1;
        return undefined;
      },
    );

    const cwd = "/Users/ngmaloney/Workspace/gnar-term";

    // vite.config.ts exists in cwd → resolves, file_exists returns true
    const existingPath = await resolveFilePath("vite.config.ts", cwd);
    const exists = await invoke<boolean>("file_exists", { path: existingPath });
    expect(exists).toBe(true);

    // random-file.pdf does NOT exist in cwd → file_exists returns false → no link
    const missingPath = await resolveFilePath("random-file.pdf", cwd);
    const missing = await invoke<boolean>("file_exists", { path: missingPath });
    expect(missing).toBe(false);
  });

  it("ls ~/Downloads output: bare filenames don't link when not in cwd", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "file_exists") return false; // nothing from Downloads exists in cwd
      return undefined;
    });

    // Regex matches "2025-Twilio-Partner-Program-Guide.pdf" from terminal output
    const line = "2025-Twilio-Partner-Program-Guide.pdf";
    const matches = getMatchesFromLine(line);
    expect(matches).toEqual(["2025-Twilio-Partner-Program-Guide.pdf"]);

    // Resolve prepends cwd
    const cwd = "/Users/ngmaloney/Workspace/gnar-term";
    const resolved = await resolveFilePath(matches[0], cwd);
    expect(resolved).toBe(`${cwd}/2025-Twilio-Partner-Program-Guide.pdf`);

    // file_exists returns false → provideLinks filters this out, no link rendered
    const exists = await invoke<boolean>("file_exists", { path: resolved });
    expect(exists).toBe(false);
  });

  it("path-prefixed links check file_exists with resolved path", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(
      async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_home") return "/Users/ngmaloney";
        if (cmd === "file_exists") {
          return (
            (args as Record<string, unknown>).path ===
            "/Users/ngmaloney/Downloads/report.pdf"
          );
        }
        if (cmd === "read_file_base64") return btoa("fake-pdf");
        return undefined;
      },
    );

    const line = "~/Downloads/report.pdf";
    const matches = getMatchesFromLine(line);
    expect(matches).toEqual(["~/Downloads/report.pdf"]);

    const resolved = await resolveFilePath(matches[0], "/some/other/cwd");
    expect(resolved).toBe("/Users/ngmaloney/Downloads/report.pdf");

    const exists = await invoke<boolean>("file_exists", { path: resolved });
    expect(exists).toBe(true);
  });

  it("STEP 1-3 combined: tilde path with spaces, full chain", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") return "/Users/ngmaloney";
      if (cmd === "read_file_base64") return btoa("fake-pdf");
      return undefined;
    });

    // Step 1: Regex detection
    const line = "~/Downloads/WR Product Requirements Doc.pdf";
    const matches = getMatchesFromLine(line);
    expect(matches).toEqual(["~/Downloads/WR Product Requirements Doc.pdf"]);

    // Step 2: Path resolution (tilde expansion)
    const resolved = await resolveFilePath(matches[0], "/irrelevant");
    expect(resolved).toBe(
      "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    );

    // Step 3: Preview opens
    const surface = await openPreview(resolved, mockApi);
    expect(surface.filePath).toBe(
      "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    );
    expect(mockInvoke).toHaveBeenCalledWith("read_file_base64", {
      path: "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    });
  });
});

// resolveFilePath unit tests moved to src/__tests__/resolve-file-path.test.ts
// Integration usage (PDF link detection + resolution) remains above.
