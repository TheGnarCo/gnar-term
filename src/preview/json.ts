import { registerPreviewer } from "./index";

registerPreviewer({
  extensions: ["json", "jsonc", "json5"],
  render(content, _filePath, element) {
    try {
      const parsed = JSON.parse(content);
      element.innerHTML = `<pre><code>${syntaxHighlight(JSON.stringify(parsed, null, 2))}</code></pre>`;
    } catch {
      element.innerHTML = `<pre><code>${escapeHtml(content)}</code></pre>`;
    }
  },
});

function syntaxHighlight(json: string): string {
  return json.replace(
    /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (match.startsWith('"')) {
        cls = match.endsWith(":") ? "json-key" : "json-string";
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      } else if (match === "null") {
        cls = "json-null";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
