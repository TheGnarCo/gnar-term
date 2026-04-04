import { marked } from "marked";
import DOMPurify from "dompurify";
import { registerPreviewer } from "./index";
import "github-markdown-css/github-markdown-dark.css";

registerPreviewer({
  extensions: ["md", "markdown", "mdx"],
  render(content, _filePath, element) {
    element.classList.add("markdown-body");
    element.innerHTML = DOMPurify.sanitize(marked.parse(content) as string);
  },
});
