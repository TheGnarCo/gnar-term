/**
 * Markdown renderer for the core preview pipeline.
 *
 * Parses markdown source and returns a sanitized DocumentFragment ready
 * to mount with `replaceChildren`. Sanitization happens here (via
 * DOMPurify) so callers don't have to re-sanitize.
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

/** Render `source` as a sanitized DocumentFragment. */
export function renderMarkdownFragment(source: string): DocumentFragment {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });
}
