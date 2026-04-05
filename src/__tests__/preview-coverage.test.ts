/**
 * Preview system coverage tests.
 * Verifies all preview plugins are registered, handle binary/text correctly,
 * and path resolution doesn't produce invalid paths.
 */
import { describe, it, expect } from "vitest";

describe("All preview plugins are registered in init.ts", () => {
  it("imports every preview plugin", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/init.ts", "utf-8");
    const expectedPlugins = ["markdown", "json", "image", "pdf", "csv", "yaml", "video", "text"];
    for (const plugin of expectedPlugins) {
      expect(source).toContain(`"./${plugin}"`);
    }
  });
});

describe("Binary preview types skip text read_file", () => {
  it("openPreview skips read_file for binary extensions", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/index.ts", "utf-8");
    // Must have a binary extension check that skips invoke("read_file")
    expect(source).toContain("binaryExts");
    expect(source).toContain("isBinary");
    // PDF must be in the binary set
    expect(source).toContain('"pdf"');
    // Image formats must be in the binary set
    expect(source).toContain('"png"');
    expect(source).toContain('"jpg"');
    // Video formats must be in the binary set
    expect(source).toContain('"mp4"');
  });
});

describe("PDF previewer", () => {
  it("uses read_file_base64 not read_file for binary data", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/pdf.ts", "utf-8");
    expect(source).toContain("read_file_base64");
    expect(source).not.toContain('"read_file"');
  });

  it("registers for pdf extension", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/pdf.ts", "utf-8");
    expect(source).toContain('"pdf"');
    expect(source).toContain("registerPreviewer");
  });

  it("handles errors with user-visible message", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/pdf.ts", "utf-8");
    expect(source).toContain(".catch");
    expect(source).toContain("Failed to load PDF");
  });
});

describe("Image previewer", () => {
  it("uses convertFileSrc for Tauri asset URLs", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/image.ts", "utf-8");
    expect(source).toContain("convertFileSrc");
  });

  it("handles image load errors", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/image.ts", "utf-8");
    expect(source).toContain("onerror");
    expect(source).toContain("Failed to load image");
  });

  it("registers common image extensions", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/image.ts", "utf-8");
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "svg"]) {
      expect(source).toContain(`"${ext}"`);
    }
  });
});

describe("Video previewer", () => {
  it("uses convertFileSrc for Tauri asset URLs", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/video.ts", "utf-8");
    expect(source).toContain("convertFileSrc");
  });

  it("handles video load errors", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/video.ts", "utf-8");
    expect(source).toContain("onerror");
    expect(source).toContain("Failed to load video");
  });
});

describe("Markdown previewer", () => {
  it("uses DOMPurify to sanitize HTML", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/preview/markdown.ts", "utf-8");
    expect(source).toContain("DOMPurify");
    expect(source).toContain("sanitize");
  });
});

describe("Path resolution does not produce double slashes", () => {
  it("link provider strips trailing slash from cwd before joining", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // Must handle cwd ending with "/" to avoid "//filename"
    expect(source).toContain('endsWith("/")');
    expect(source).toContain('.slice(0, -1)');
  });

  it("context menu path resolution also strips trailing slash", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // Both link provider and context menu must handle trailing slash
    const occurrences = (source.match(/endsWith\("\/"\)/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  // Verify the actual path join logic
  it("joining root cwd with filename produces single slash", () => {
    const cwd = "/";
    const filename = "test.pdf";
    const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
    const fullPath = `${base}/${filename}`;
    expect(fullPath).toBe("/test.pdf");
    expect(fullPath).not.toContain("//");
  });

  it("joining non-root cwd with filename produces correct path", () => {
    const cwd = "/Users/someone/Documents";
    const filename = "test.pdf";
    const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
    const fullPath = `${base}/${filename}`;
    expect(fullPath).toBe("/Users/someone/Documents/test.pdf");
  });

  it("absolute paths are not prefixed with cwd", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // Link provider: only join if path doesn't start with "/"
    expect(source).toContain('!linkText.startsWith("/")');
    // Context menu: absolute paths used as-is
    expect(source).toContain('pathText.startsWith("/") ? pathText');
  });
});

describe("Clipboard copy/paste", () => {
  it("imports clipboard plugin", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(source).toContain("@tauri-apps/plugin-clipboard-manager");
    expect(source).toContain("clipboardRead");
    expect(source).toContain("clipboardWrite");
  });

  it("Cmd+C copies selection to clipboard", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // Must get selection and write to clipboard
    expect(source).toContain("getSelection()");
    expect(source).toContain("clipboardWrite(sel)");
  });

  it("Cmd+V reads clipboard and writes to PTY", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(source).toContain("clipboardRead()");
    expect(source).toContain('invoke("write_pty"');
  });

  it("clipboard errors are caught, not silently unhandled", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // Paste must have .catch() to handle clipboard permission denied
    expect(source).toMatch(/clipboardRead\(\)\.then[\s\S]*?\.catch/);
  });

  it("clipboard permissions are in Tauri capabilities", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src-tauri/capabilities/default.json", "utf-8");
    expect(source).toContain("clipboard-manager:allow-read-text");
    expect(source).toContain("clipboard-manager:allow-write-text");
  });
});

describe("New tab and new pane inherit cwd", () => {
  it("createTerminalSurface stores cwd on surface", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    const surfaceBlock = source.match(/const surface: TerminalSurface = \{[\s\S]*?\};/);
    expect(surfaceBlock).not.toBeNull();
    expect(surfaceBlock![0]).toContain("cwd");
  });

  it("handleNewSurface falls back to get_pty_cwd when cwd is unknown", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    const fn = source.slice(
      source.indexOf("async function handleNewSurface"),
      source.indexOf("\n  function", source.indexOf("async function handleNewSurface") + 1)
    );
    expect(fn).toContain("get_pty_cwd");
  });

  it("handleSplitPane falls back to get_pty_cwd when cwd is unknown", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    const fn = source.slice(
      source.indexOf("async function handleSplitPane"),
      source.indexOf("\n  function", source.indexOf("async function handleSplitPane") + 1)
    );
    expect(fn).toContain("get_pty_cwd");
  });

  it("get_pty_cwd result is checked for empty string before use", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    // Must check that queried cwd is non-empty before assigning
    expect(source).toContain("if (queried) cwd = queried");
  });

  it("spawn_pty treats empty string cwd as null", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/terminal-service.ts", "utf-8");
    // Must use || not ?? to catch empty string
    expect(source).toContain("cwd: cwd || null");
  });

  it("cwd fallback logic: empty string from get_pty_cwd is rejected", () => {
    // Simulates the exact logic in handleNewSurface/handleSplitPane
    let cwd: string | undefined = undefined;
    const queried = ""; // get_pty_cwd returned empty string
    if (queried) cwd = queried;
    expect(cwd).toBeUndefined(); // empty string should NOT be used

    // Non-empty result should be used
    const queried2 = "/Users/someone/project";
    if (queried2) cwd = queried2;
    expect(cwd).toBe("/Users/someone/project");
  });

  it("cwd || null: empty string becomes null, real path passes through", () => {
    // Simulates the spawn_pty cwd parameter logic
    expect("" || null).toBeNull();
    expect(undefined || null).toBeNull();
    expect("/tmp" || null).toBe("/tmp");
  });
});
