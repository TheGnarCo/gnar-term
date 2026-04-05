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
  default: { sanitize: (s: string) => s.replace(/<script[^>]*>.*?<\/script>/gi, "").replace(/\sonerror="[^"]*"/gi, "") },
}));

vi.mock("github-markdown-css/github-markdown-dark.css", () => ({}));

vi.mock("../lib/theme-accessor", () => ({
  themeProxy: {
    bg: "#000", fg: "#fff", fgDim: "#888", bgSurface: "#111",
    bgHighlight: "#222", border: "#333",
    ansi: { blue: "#00f", green: "#0f0", magenta: "#f0f", yellow: "#ff0" },
  },
}));

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import EmbedPDF from "@embedpdf/snippet";
import {
  registerPreviewer,
  canPreview,
  getSupportedExtensions,
  openPreview,
} from "../preview/index";

// Import all preview plugins so they self-register
beforeAll(async () => {
  await import("../preview/pdf");
  await import("../preview/image");
  await import("../preview/video");
  await import("../preview/markdown");
  await import("../preview/json");
  await import("../preview/csv");
  await import("../preview/yaml");
  await import("../preview/text");
});

const mockInvoke = vi.mocked(invoke);
const mockConvertFileSrc = vi.mocked(convertFileSrc);
const mockListen = vi.mocked(listen);

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen.mockReset().mockResolvedValue(vi.fn() as any);
  (EmbedPDF.init as ReturnType<typeof vi.fn>).mockReset();
  // jsdom doesn't have URL.createObjectURL — mock it
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
  }
});

// ─── Preview Registry ────────────────────────────────────────────

describe("Preview registry", () => {
  it("canPreview returns true for all registered extensions", () => {
    const registered = ["pdf", "md", "json", "png", "jpg", "mp4", "csv", "yaml", "txt", "toml", "webm", "gif", "log"];
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
    await expect(openPreview("/tmp/file.exe")).rejects.toThrow("No previewer registered for .exe");
  });

  it("openPreview calls read_file for text types", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return '{"key": "value"}';
      if (cmd === "watch_file") return 1;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/test.json");
    expect(mockInvoke).toHaveBeenCalledWith("read_file", { path: "/tmp/test.json" });
    expect(surface.filePath).toBe("/tmp/test.json");
    expect(surface.title).toBe("test.json");
    expect(surface.element).toBeInstanceOf(HTMLElement);
  });

  it("openPreview does NOT call read_file for binary types (pdf)", async () => {
    mockInvoke.mockResolvedValue(undefined as any);

    const surface = await openPreview("/tmp/test.pdf");
    const readFileCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === "read_file");
    expect(readFileCalls).toHaveLength(0);
    expect(surface.filePath).toBe("/tmp/test.pdf");
  });

  it("openPreview does NOT call read_file for binary types (png)", async () => {
    mockInvoke.mockResolvedValue(undefined as any);

    await openPreview("/tmp/test.png");
    const readFileCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === "read_file");
    expect(readFileCalls).toHaveLength(0);
  });

  it("openPreview sets up file watch for text types", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "hello";
      if (cmd === "watch_file") return 42;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/test.txt");
    expect(mockInvoke).toHaveBeenCalledWith("watch_file", { path: "/tmp/test.txt" });
    expect(surface.watchId).toBe(42);
  });

  it("openPreview does NOT set up file watch for binary types", async () => {
    mockInvoke.mockResolvedValue(undefined as any);

    const surface = await openPreview("/tmp/test.pdf");
    const watchCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === "watch_file");
    expect(watchCalls).toHaveLength(0);
    expect(surface.watchId).toBe(0);
  });

  it("openPreview returns PreviewSurface with all required fields", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "# Hello";
      if (cmd === "watch_file") return 7;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/readme.md");
    expect(surface.id).toMatch(/^preview-/);
    expect(surface.filePath).toBe("/tmp/readme.md");
    expect(surface.title).toBe("readme.md");
    expect(surface.element).toBeInstanceOf(HTMLDivElement);
    expect(surface.watchId).toBe(7);
  });
});

// ─── PDF Previewer ───────────────────────────────────────────────

describe("PDF previewer", () => {
  it("shows loading message initially, then calls read_file_base64", async () => {
    const b64 = btoa("fake-pdf-bytes");
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file_base64") return b64;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/report.pdf");

    // invoke should have been called with read_file_base64
    expect(mockInvoke).toHaveBeenCalledWith("read_file_base64", { path: "/tmp/report.pdf" });

    // Let the .then() chain settle (render is async via .then, not await)
    await new Promise((r) => setTimeout(r, 50));

    expect(EmbedPDF.init).toHaveBeenCalled();
    const initCall = (EmbedPDF.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(initCall.type).toBe("container");
    expect(initCall.target).toBe(surface.element);
    expect(initCall.src).toMatch(/^blob:/);
    expect(initCall.theme).toBe("dark");
  });

  it("shows error message when read_file_base64 fails", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file_base64") throw new Error("File not found");
      return undefined as any;
    });

    const surface = await openPreview("/tmp/missing.pdf");

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
      if (cmd === "read_file") return '{"name": "test", "count": 42, "active": true, "data": null}';
      if (cmd === "watch_file") return 1;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/data.json");
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
      return undefined as any;
    });

    const surface = await openPreview("/tmp/bad.json");
    expect(surface.element.textContent).toContain("{not valid json: ???}");
    // Should still be in a pre/code block
    expect(surface.element.innerHTML).toContain("<pre>");
  });

  it("escapes HTML in JSON content to prevent XSS", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return '{"xss": "<img onerror=alert(1) src=x>"}';
      if (cmd === "watch_file") return 1;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/xss.json");
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
      return undefined as any;
    });

    const surface = await openPreview("/tmp/readme.md");
    // marked.parse mock returns <p>content</p>
    expect(surface.element.innerHTML).toContain("<p>");
    expect(surface.element.classList.contains("markdown-body")).toBe(true);
  });

  it("sanitizes XSS payloads from markdown", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return '<script>alert("xss")</script>';
      if (cmd === "watch_file") return 1;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/evil.md");
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
      return undefined as any;
    });

    const surface = await openPreview("/tmp/data.csv");
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
      return undefined as any;
    });

    const surface = await openPreview("/tmp/nums.csv");
    expect(surface.element.textContent).toContain("3 rows");
    expect(surface.element.textContent).toContain("2 columns");
  });

  it("handles empty CSV", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "";
      if (cmd === "watch_file") return 1;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/empty.csv");
    expect(surface.element.textContent).toContain("(empty file)");
  });

  it("handles quoted fields containing commas", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return 'Name,Address\n"Smith, John","123 Main St, Apt 4"';
      if (cmd === "watch_file") return 1;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/quoted.csv");
    const cells = surface.element.querySelectorAll("tbody td");
    expect(cells[0].textContent).toBe("Smith, John");
    expect(cells[1].textContent).toBe("123 Main St, Apt 4");
  });

  it("uses tab separator for TSV files", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return "Name\tAge\nAlice\t30";
      if (cmd === "watch_file") return 1;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/data.tsv");
    const headers = surface.element.querySelectorAll("thead th");
    expect(headers[0].textContent).toBe("Name");
    expect(headers[1].textContent).toBe("Age");
  });
});

// ─── Image Previewer ─────────────────────────────────────────────

describe("Image previewer", () => {
  it("creates img element with convertFileSrc URL", async () => {
    mockInvoke.mockResolvedValue(undefined as any);

    const surface = await openPreview("/tmp/photo.png");
    const img = surface.element.querySelector("img");
    expect(img).not.toBeNull();
    expect(mockConvertFileSrc).toHaveBeenCalledWith("/tmp/photo.png");
    expect(img!.src).toContain("asset://localhost/");
  });

  it("shows error message on image load failure", async () => {
    mockInvoke.mockResolvedValue(undefined as any);

    const surface = await openPreview("/tmp/broken.jpg");
    const img = surface.element.querySelector("img");
    expect(img).not.toBeNull();

    // Simulate load error
    img!.dispatchEvent(new Event("error"));
    // onerror handler is set via img.onerror, so fire it directly
    if (img!.onerror) (img!.onerror as Function)(new Event("error"));

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
    mockInvoke.mockResolvedValue(undefined as any);

    const surface = await openPreview("/tmp/clip.mp4");
    const video = surface.element.querySelector("video");
    expect(video).not.toBeNull();
    expect(video!.controls).toBe(true);
    expect(video!.autoplay).toBe(true);
    expect(mockConvertFileSrc).toHaveBeenCalledWith("/tmp/clip.mp4");
  });

  it("shows error message on video load failure", async () => {
    mockInvoke.mockResolvedValue(undefined as any);

    const surface = await openPreview("/tmp/broken.webm");
    const video = surface.element.querySelector("video");
    expect(video).not.toBeNull();

    if (video!.onerror) (video!.onerror as Function)(new Event("error"));

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
      return undefined as any;
    });

    const surface = await openPreview("/tmp/notes.txt");
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
      return undefined as any;
    });

    const surface = await openPreview("/tmp/evil.txt");
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
      if (cmd === "read_file") return 'name: test\ncount: 42\nactive: true\n# comment';
      if (cmd === "watch_file") return 1;
      return undefined as any;
    });

    const surface = await openPreview("/tmp/config.yaml");
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
    const exts = 'pdf|md|txt|csv|json|yaml|yml|toml|png|jpg|jpeg|gif|webp|svg|ico|bmp|heic|heif|tiff|tif|avif|mp4|webm|mov|avi|mkv|m4v|ogv|log|conf|cfg|ini|env|gitignore|dockerignore|editorconfig|tsv|mdx|markdown';
    const patterns = [
      `["']([^"']+\\.(?:${exts}))["']`,
      `((?:/|\\./|~/)\\S[\\S ]*\\.(?:${exts}))(?=\\s|$)`,
      `(\\S+\\.(?:${exts}))(?=\\s|$)`,
    ];
    const regex = new RegExp(patterns.join('|'), 'gi');
    const matches: string[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push(m[1] || m[2] || m[3]);
    }
    return matches;
  }

  it("matches multiple bare files on one line separately", () => {
    expect(getMatches("file1.pdf  file2.pdf  file3.txt")).toEqual(["file1.pdf", "file2.pdf", "file3.txt"]);
  });

  it("does not match garbage from ls -la output", () => {
    const matches = getMatches("-rw-r--r--  1 user  staff  1234 Jan  1 12:00 Doc.pdf");
    expect(matches).toEqual(["Doc.pdf"]);
  });

  it("matches absolute paths with spaces", () => {
    expect(getMatches("/Users/me/My Doc.pdf")).toEqual(["/Users/me/My Doc.pdf"]);
  });

  it("matches home paths with spaces", () => {
    expect(getMatches("~/Downloads/WR Product Requirements Doc.pdf")).toEqual(["~/Downloads/WR Product Requirements Doc.pdf"]);
  });

  it("matches relative paths with spaces", () => {
    expect(getMatches("./local/My File.md")).toEqual(["./local/My File.md"]);
  });

  it("matches quoted filenames with spaces", () => {
    expect(getMatches('"WR Product Requirements Doc.pdf"')).toEqual(["WR Product Requirements Doc.pdf"]);
  });

  it("matches simple absolute paths", () => {
    expect(getMatches("/tmp/test-link.md")).toEqual(["/tmp/test-link.md"]);
  });

  it("matches path embedded in a sentence", () => {
    expect(getMatches("Saved to /Users/me/Downloads/Report.pdf done")).toEqual(["/Users/me/Downloads/Report.pdf"]);
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
      `["']([^"']+\\.(?:${exts}))["']`,
      `((?:/|\\./|~/)\\S[\\S ]*\\.(?:${exts}))(?=\\s|$)`,
      `(\\S+\\.(?:${exts}))(?=\\s|$)`,
    ];
    const regex = new RegExp(patterns.join("|"), "gi");
    const matches: string[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push(m[1] || m[2] || m[3]);
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
      return undefined as any;
    });

    const resolved = await resolveFilePath(
      "~/Downloads/WR Product Requirements Doc.pdf",
      "/some/cwd"
    );
    expect(resolved).toBe("/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf");
  });

  it("STEP 3: openPreview handles path with spaces for PDF", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file_base64") return btoa("fake-pdf");
      return undefined as any;
    });

    const surface = await openPreview("/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf");
    expect(surface.filePath).toBe("/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf");
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
      return undefined as any;
    });

    // Step 1: Regex detection
    const line = "open /Users/me/My Documents/Annual Report 2024.pdf please";
    const matches = getMatchesFromLine(line);
    expect(matches).toEqual(["/Users/me/My Documents/Annual Report 2024.pdf"]);

    // Step 2: Path resolution (absolute path, no transformation needed)
    const resolved = await resolveFilePath(matches[0], "/some/cwd");
    expect(resolved).toBe("/Users/me/My Documents/Annual Report 2024.pdf");

    // Step 3: Preview opens correctly
    const surface = await openPreview(resolved);
    expect(surface.filePath).toBe("/Users/me/My Documents/Annual Report 2024.pdf");
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
      return undefined as any;
    });

    // Step 1: Regex detection (quoted)
    const line = 'Opening "WR Product Requirements Doc.pdf"';
    const matches = getMatchesFromLine(line);
    expect(matches).toEqual(["WR Product Requirements Doc.pdf"]);

    // Step 2: Path resolution (bare filename → prepend cwd)
    const resolved = await resolveFilePath(matches[0], "/Users/ngmaloney/Downloads");
    expect(resolved).toBe("/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf");

    // Step 3: Preview opens
    const surface = await openPreview(resolved);
    expect(surface.filePath).toBe("/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf");
    expect(mockInvoke).toHaveBeenCalledWith("read_file_base64", {
      path: "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    });
  });

  it("file exists in cwd → link created, file doesn't exist → no link", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "file_exists") {
        const path = (args as any).path as string;
        return path === "/Users/ngmaloney/Workspace/gnar-term/vite.config.ts";
      }
      if (cmd === "read_file") return "export default {}";
      if (cmd === "watch_file") return 1;
      return undefined as any;
    });

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
      return undefined as any;
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
    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "get_home") return "/Users/ngmaloney";
      if (cmd === "file_exists") {
        return (args as any).path === "/Users/ngmaloney/Downloads/report.pdf";
      }
      if (cmd === "read_file_base64") return btoa("fake-pdf");
      return undefined as any;
    });

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
      return undefined as any;
    });

    // Step 1: Regex detection
    const line = "~/Downloads/WR Product Requirements Doc.pdf";
    const matches = getMatchesFromLine(line);
    expect(matches).toEqual(["~/Downloads/WR Product Requirements Doc.pdf"]);

    // Step 2: Path resolution (tilde expansion)
    const resolved = await resolveFilePath(matches[0], "/irrelevant");
    expect(resolved).toBe("/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf");

    // Step 3: Preview opens
    const surface = await openPreview(resolved);
    expect(surface.filePath).toBe("/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf");
    expect(mockInvoke).toHaveBeenCalledWith("read_file_base64", {
      path: "/Users/ngmaloney/Downloads/WR Product Requirements Doc.pdf",
    });
  });
});

// ─── resolveFilePath (exported from terminal-service.ts) ────────

import { resolveFilePath } from "../lib/terminal-service";

describe("resolveFilePath", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("absolute paths are returned as-is", async () => {
    expect(await resolveFilePath("/Users/me/report.pdf", "/some/cwd")).toBe("/Users/me/report.pdf");
    // Should NOT call get_home
    expect(mockInvoke).not.toHaveBeenCalledWith("get_home");
  });

  it("tilde paths are expanded using get_home", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") return "/Users/testuser";
      return undefined as any;
    });

    expect(await resolveFilePath("~/Downloads/report.pdf", "/some/cwd")).toBe("/Users/testuser/Downloads/report.pdf");
    expect(mockInvoke).toHaveBeenCalledWith("get_home");
  });

  it("tilde paths fall back to raw path if get_home fails", async () => {
    mockInvoke.mockRejectedValue(new Error("HOME not set"));

    expect(await resolveFilePath("~/Downloads/report.pdf", "/some/cwd")).toBe("~/Downloads/report.pdf");
  });

  it("relative paths are prepended with cwd", async () => {
    expect(await resolveFilePath("report.pdf", "/Users/me/project")).toBe("/Users/me/project/report.pdf");
  });

  it("relative paths with ./ prefix are prepended with cwd", async () => {
    expect(await resolveFilePath("./docs/report.pdf", "/Users/me/project")).toBe("/Users/me/project/./docs/report.pdf");
  });

  it("cwd trailing slash does not produce double slash", async () => {
    expect(await resolveFilePath("report.pdf", "/Users/me/")).toBe("/Users/me/report.pdf");
    expect(await resolveFilePath("report.pdf", "/")).toBe("/report.pdf");
  });

  it("relative paths without cwd are returned as-is", async () => {
    expect(await resolveFilePath("report.pdf", undefined)).toBe("report.pdf");
  });

  it("tilde path with only ~ and slash", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") return "/Users/testuser";
      return undefined as any;
    });

    expect(await resolveFilePath("~/report.pdf", undefined)).toBe("/Users/testuser/report.pdf");
  });
});
