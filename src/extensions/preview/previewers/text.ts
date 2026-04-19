import { registerPreviewer } from "../preview-registry";

registerPreviewer({
  extensions: [
    "txt",
    "log",
    "conf",
    "cfg",
    "ini",
    "env",
    "gitignore",
    "dockerignore",
    "editorconfig",
  ],
  render(content, _filePath, element, ctx) {
    const fgDim = ctx?.theme.fgDim ?? "#888";
    const escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const lines = escaped.split("\n");
    const numbered = lines
      .map((line, i) => {
        const num = `<span style="color: ${fgDim}; display: inline-block; width: 4em; text-align: right; margin-right: 1.5em; user-select: none;">${i + 1}</span>`;
        return `${num}${line}`;
      })
      .join("\n");

    element.innerHTML = `<pre style="
      font-family: 'JetBrainsMono Nerd Font Mono', Menlo, monospace;
      font-size: 13px; line-height: 1.6; margin: 0;
      white-space: pre-wrap; word-break: break-all;
    "><code>${numbered}</code></pre>`;
  },
});
