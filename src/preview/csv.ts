import { registerPreviewer } from "./index";
import { theme } from "../theme";

registerPreviewer({
  extensions: ["csv", "tsv"],
  render(content, filePath, element) {
    const separator = filePath.endsWith(".tsv") ? "\t" : ",";
    const lines = content.split("\n").filter(l => l.trim());
    if (lines.length === 0) {
      element.textContent = "(empty file)";
      return;
    }

    const parseRow = (line: string): string[] => {
      const cells: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === separator && !inQuotes) { cells.push(current.trim()); current = ""; }
        else { current += ch; }
      }
      cells.push(current.trim());
      return cells;
    };

    const headers = parseRow(lines[0]);
    const rows = lines.slice(1).map(parseRow);

    const table = document.createElement("table");
    table.style.cssText = `
      border-collapse: collapse; width: 100%; font-size: 13px;
      font-family: "JetBrainsMono Nerd Font Mono", Menlo, monospace;
    `;

    // Header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const h of headers) {
      const th = document.createElement("th");
      th.textContent = h;
      th.style.cssText = `
        padding: 8px 12px; text-align: left; font-weight: 600;
        background: ${theme.bgSurface}; border: 1px solid ${theme.border};
        color: ${theme.fg}; position: sticky; top: 0;
      `;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const cell of row) {
        const td = document.createElement("td");
        td.textContent = cell;
        td.style.cssText = `
          padding: 6px 12px; border: 1px solid ${theme.border};
          color: ${theme.fg};
        `;
        tr.appendChild(td);
      }
      tr.addEventListener("mouseenter", () => { tr.style.background = theme.bgHighlight; });
      tr.addEventListener("mouseleave", () => { tr.style.background = "transparent"; });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    element.innerHTML = `<div style="color: ${theme.fgDim}; font-size: 12px; margin-bottom: 8px;">${rows.length} rows × ${headers.length} columns</div>`;
    element.appendChild(table);
  },
});
