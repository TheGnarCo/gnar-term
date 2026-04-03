import { marked } from "marked";
import { registerPreviewer } from "./index";

registerPreviewer({
  extensions: ["md", "markdown", "mdx"],
  render(content, _filePath, element) {
    element.innerHTML = marked.parse(content) as string;
  },
});
