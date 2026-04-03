import { registerPreviewer } from "./index";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";

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

        const pageDiv = document.createElement("div");
        pageDiv.style.cssText = `position: relative; max-width: 100%;`;

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.cssText = "width: 100%; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);";
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
        pageDiv.appendChild(canvas);

        element.appendChild(pageDiv);
      }
    }).catch((err) => {
      element.innerHTML = `<div style="color: #f85149; padding: 20px;">Failed to load PDF: ${err}</div>`;
    });
  },
});
