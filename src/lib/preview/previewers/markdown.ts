import {
  registerPreviewer,
  type PreviewContext,
} from "../../services/preview-registry";
import { renderMarkdownFragment } from "../../markdown/render";
import "github-markdown-css/github-markdown-dark.css";

function renderMarkdown(
  content: string,
  element: HTMLElement,
  filePath: string = "",
  ctx?: PreviewContext,
): void {
  element.classList.add("markdown-body");
  element.style.display = "block";

  element.replaceChildren(renderMarkdownFragment(content));

  if (ctx && filePath) {
    const dir = filePath.includes("/")
      ? filePath.substring(0, filePath.lastIndexOf("/"))
      : "";
    for (const img of element.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (
        !src ||
        src.startsWith("http://") ||
        src.startsWith("https://") ||
        src.startsWith("asset://") ||
        src.startsWith("data:")
      )
        continue;
      const resolved = src.startsWith("/") ? src : dir ? `${dir}/${src}` : src;
      img.src = ctx.convertFileSrc(resolved);
    }
  }
}

registerPreviewer({
  extensions: ["md", "markdown", "mdx"],
  render(content, filePath, element, ctx) {
    renderMarkdown(content, element, filePath, ctx);
  },
});
