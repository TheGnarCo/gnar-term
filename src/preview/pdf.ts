import { registerPreviewer } from "./index";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

registerPreviewer({
  extensions: ["pdf"],
  render(_content, filePath, element) {
    element.innerHTML = `<div style="text-align: center; color: #888; padding: 20px;">Loading PDF...</div>`;

    invoke<string>("read_file_base64", { path: filePath }).then(async (b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      element.innerHTML = "";
      element.style.display = "flex";
      element.style.flexDirection = "column";
      element.style.alignItems = "center";
      element.style.gap = "12px";
      element.style.padding = "16px";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 1.5;
        const viewport = page.getViewport({ scale });

        // Container for canvas + text layer
        const pageDiv = document.createElement("div");
        pageDiv.style.cssText = `position: relative; width: ${viewport.width}px; height: ${viewport.height}px; max-width: 100%;`;

        // Canvas
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.cssText = "width: 100%; height: 100%; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);";
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        pageDiv.appendChild(canvas);

        // Text layer (enables cmd+F and copy/paste)
        const textContent = await page.getTextContent();
        const textDiv = document.createElement("div");
        textDiv.classList.add("textLayer");
        textDiv.style.cssText = `
          position: absolute; top: 0; left: 0;
          width: ${viewport.width}px; height: ${viewport.height}px;
          overflow: hidden; opacity: 0.3;
        `;
        pageDiv.appendChild(textDiv);

        // Render text spans
        const textItems = textContent.items as any[];
        for (const item of textItems) {
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const span = document.createElement("span");
          span.textContent = item.str;
          span.style.cssText = `
            position: absolute;
            left: ${tx[4]}px;
            top: ${viewport.height - tx[5]}px;
            font-size: ${Math.abs(tx[3])}px;
            font-family: sans-serif;
            white-space: pre;
            pointer-events: all;
            color: transparent;
          `;
          textDiv.appendChild(span);
        }

        element.appendChild(pageDiv);
      }
    }).catch((err) => {
      element.innerHTML = `<div style="color: #f85149; padding: 20px;">Failed to load PDF: ${err}</div>`;
    });
  },
});
