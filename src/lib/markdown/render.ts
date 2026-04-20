/**
 * Markdown chunk renderer for the core preview pipeline.
 *
 * Splits a markdown source into an ordered sequence of chunks:
 *
 *   - "markdown" — pre-rendered HTML for a stretch of normal markdown
 *   - "widget"   — a directive extracted from a fenced code block whose
 *                  info-string matches `gnar:<name>` (a "markdown-component")
 *
 * The markdown previewer renders markdown chunks as HTML and widget
 * chunks via the markdown-component registry.
 *
 * Why a chunked output instead of a single HTML string + DOM-walk?
 *   - Svelte component instantiation requires real Svelte mounting, not
 *     `innerHTML` injection. Splitting cleanly upfront lets the template
 *     iterate `{#each chunks}` and use `<svelte:component>` for widgets.
 *   - We get the markdown tokenizer (marked) for free without
 *     hand-parsing fenced blocks (and their interaction with nested
 *     fences, indented blocks, etc.).
 *
 * YAML config parsing uses the `yaml` package. Parse failures surface as
 * widget chunks with an `error` field — the view renders a clear message
 * instead of throwing or dropping the block.
 */
import { marked, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { parse as parseYaml } from "yaml";

export type MarkdownChunk =
  | { kind: "markdown"; html: string }
  | {
      kind: "widget";
      name: string;
      config: Record<string, unknown>;
      raw: string;
      error?: string;
    };

const WIDGET_INFO_RE = /^gnar:([\w-]+)$/;

/**
 * Parse a markdown source into ordered chunks. Markdown sections are
 * coalesced — consecutive non-widget tokens render as a single
 * "markdown" chunk so the marked output is contiguous and styling
 * (lists, blockquotes, etc.) doesn't break across artificial chunk
 * boundaries.
 */
export function parseMarkdownChunks(source: string): MarkdownChunk[] {
  const tokens = marked.lexer(source);
  const chunks: MarkdownChunk[] = [];
  let mdBuffer: Tokens.Generic[] = [];

  const flushMarkdown = () => {
    if (mdBuffer.length === 0) return;
    const html = DOMPurify.sanitize(
      marked.parser(mdBuffer as unknown as Tokens.Generic[]),
    );
    chunks.push({ kind: "markdown", html });
    mdBuffer = [];
  };

  for (const token of tokens) {
    if (token.type === "code") {
      const code = token as Tokens.Code;
      const lang = (code.lang ?? "").trim();
      const match = lang.match(WIDGET_INFO_RE);
      if (match && match[1]) {
        flushMarkdown();
        const name = match[1];
        const raw = code.text ?? "";
        chunks.push(parseWidget(name, raw));
        continue;
      }
    }
    mdBuffer.push(token as Tokens.Generic);
  }

  flushMarkdown();
  return chunks;
}

function parseWidget(name: string, raw: string): MarkdownChunk {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { kind: "widget", name, config: {}, raw };
  }
  try {
    const parsed = parseYaml(raw);
    const config: Record<string, unknown> =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { value: parsed };
    return { kind: "widget", name, config, raw };
  } catch (err) {
    return {
      kind: "widget",
      name,
      config: {},
      raw,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
