/**
 * Markdown HTML renderer for the core preview pipeline.
 *
 * Renders a markdown source to a sanitized HTML string. The previewer
 * mounts the result via DOMPurify to defend against script injection.
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

/** Render `source` as sanitized HTML. */
export function renderMarkdownHtml(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false }) as string);
}
