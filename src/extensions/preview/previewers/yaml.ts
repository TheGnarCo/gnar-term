import { registerPreviewer } from "../preview-registry";

registerPreviewer({
  extensions: ["yaml", "yml", "toml"],
  render(content, _filePath, element, ctx) {
    const theme = ctx?.theme ?? {
      fgDim: "#888",
      ansi: { blue: "#00f", green: "#0f0", yellow: "#ff0", magenta: "#f0f" },
    };
    const highlighted = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(
        /^(\s*)([\w.-]+)(\s*[:=])/gm,
        `$1<span style="color:${theme.ansi.blue}">$2</span>$3`,
      )
      .replace(
        /:\s*"([^"]*)"/g,
        `: <span style="color:${theme.ansi.green}">"$1"</span>`,
      )
      .replace(
        /:\s*'([^']*)'/g,
        `: <span style="color:${theme.ansi.green}">'$1'</span>`,
      )
      .replace(
        /:\s*(true|false)\b/g,
        `: <span style="color:${theme.ansi.yellow}">$1</span>`,
      )
      .replace(
        /:\s*(\d+\.?\d*)\s*$/gm,
        `: <span style="color:${theme.ansi.magenta}">$1</span>`,
      )
      .replace(/(#.*)$/gm, `<span style="color:${theme.fgDim}">$1</span>`);

    element.innerHTML = `<pre style="
      font-family: 'JetBrainsMono Nerd Font Mono', Menlo, monospace;
      font-size: 13px; line-height: 1.6; margin: 0;
    "><code>${highlighted}</code></pre>`;
  },
});
