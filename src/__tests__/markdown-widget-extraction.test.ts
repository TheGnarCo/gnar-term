/**
 * Tests for parseMarkdownChunks — the splitter that takes a markdown
 * source and returns an ordered list of `{ kind: "markdown" | "widget" }`
 * chunks for the core markdown previewer.
 */
import { describe, it, expect } from "vitest";
import { parseMarkdownChunks } from "../lib/markdown/render";

describe("parseMarkdownChunks", () => {
  it("returns a single markdown chunk for plain prose", () => {
    const chunks = parseMarkdownChunks("# Hello\n\nWorld.\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("markdown");
    if (chunks[0].kind === "markdown") {
      expect(chunks[0].html).toContain("<h1");
      expect(chunks[0].html).toContain("Hello");
      expect(chunks[0].html).toContain("World.");
    }
  });

  it("extracts a single widget from a `gnar:foo` fenced block", () => {
    const md = ["```gnar:counter", "start: 5", "step: 2", "```", ""].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("widget");
    if (chunks[0].kind === "widget") {
      expect(chunks[0].name).toBe("counter");
      expect(chunks[0].config).toEqual({ start: 5, step: 2 });
      expect(chunks[0].error).toBeUndefined();
    }
  });

  it("returns chunks in source order: markdown → widget → markdown", () => {
    const md = [
      "# Top",
      "",
      "Intro paragraph.",
      "",
      "```gnar:hello",
      "name: world",
      "```",
      "",
      "Closing words.",
      "",
    ].join("\n");

    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].kind).toBe("markdown");
    expect(chunks[1].kind).toBe("widget");
    expect(chunks[2].kind).toBe("markdown");

    if (chunks[0].kind === "markdown") {
      expect(chunks[0].html).toContain("Intro paragraph");
    }
    if (chunks[1].kind === "widget") {
      expect(chunks[1].name).toBe("hello");
      expect(chunks[1].config).toEqual({ name: "world" });
    }
    if (chunks[2].kind === "markdown") {
      expect(chunks[2].html).toContain("Closing words");
    }
  });

  it("widget chunks with invalid YAML carry an error and empty config", () => {
    // Block scalar `:` followed by `} ` produces invalid YAML.
    const md = [
      "```gnar:broken",
      "key: value",
      "  bad: } { nested",
      "another: : :",
      "```",
    ].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("widget");
    if (chunks[0].kind === "widget") {
      expect(chunks[0].name).toBe("broken");
      expect(chunks[0].error).toBeTruthy();
      expect(chunks[0].config).toEqual({});
      expect(chunks[0].raw).toContain("bad:");
    }
  });

  it("empty info-string `gnar:` (no widget name) is treated as a regular code block", () => {
    const md = ["```gnar:", "anything", "```"].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("markdown");
    if (chunks[0].kind === "markdown") {
      expect(chunks[0].html).toContain("<code");
      expect(chunks[0].html).toContain("anything");
    }
  });

  it("non-gnar info-strings (ts, bash, etc.) stay as code blocks", () => {
    const md = [
      "```ts",
      "const x = 1;",
      "```",
      "",
      "```bash",
      "echo hi",
      "```",
    ].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("markdown");
    if (chunks[0].kind === "markdown") {
      expect(chunks[0].html).toContain("const x = 1");
      expect(chunks[0].html).toContain("echo hi");
      expect(chunks[0].html).toContain("<code");
    }
  });

  it("widget with empty body returns empty config and no error", () => {
    const md = ["```gnar:bare", "```"].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("widget");
    if (chunks[0].kind === "widget") {
      expect(chunks[0].name).toBe("bare");
      expect(chunks[0].config).toEqual({});
      expect(chunks[0].error).toBeUndefined();
    }
  });

  it("widget names accept letters, digits, hyphens, underscores", () => {
    const md = ["```gnar:my-widget_2", "ok: true", "```"].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("widget");
    if (chunks[0].kind === "widget") {
      expect(chunks[0].name).toBe("my-widget_2");
    }
  });

  it("info-strings with extra text after the name (e.g. `gnar:foo bar`) are not extracted", () => {
    // The regex requires the entire info-string to be `gnar:<name>` so a
    // typo like `gnar:foo bar` falls through to a regular code block —
    // this surfaces user error instead of guessing intent.
    const md = ["```gnar:foo bar", "key: value", "```"].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("markdown");
  });

  it("multiple widgets in sequence each render as their own chunk", () => {
    const md = [
      "```gnar:a",
      "x: 1",
      "```",
      "",
      "Between widgets.",
      "",
      "```gnar:b",
      "y: 2",
      "```",
    ].join("\n");

    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].kind).toBe("widget");
    expect(chunks[1].kind).toBe("markdown");
    expect(chunks[2].kind).toBe("widget");
    if (chunks[0].kind === "widget") expect(chunks[0].name).toBe("a");
    if (chunks[2].kind === "widget") expect(chunks[2].name).toBe("b");
  });

  it("YAML scalar (non-object) config is wrapped in { value: ... }", () => {
    const md = ["```gnar:scalar", "just-a-string", "```"].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(1);
    if (chunks[0].kind === "widget") {
      expect(chunks[0].config).toEqual({ value: "just-a-string" });
    }
  });

  it("YAML array config is wrapped in { value: [...] }", () => {
    const md = ["```gnar:list", "- one", "- two", "```"].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(1);
    if (chunks[0].kind === "widget") {
      expect(chunks[0].config).toEqual({ value: ["one", "two"] });
    }
  });

  it("nested fenced markdown blocks parse without crashing", () => {
    // Deliberately mix a widget with a regular code block right after.
    const md = [
      "```gnar:demo",
      "title: hi",
      "```",
      "",
      "```",
      "this is a plain fence",
      "```",
    ].join("\n");
    const chunks = parseMarkdownChunks(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].kind).toBe("widget");
    expect(chunks[1].kind).toBe("markdown");
  });
});
