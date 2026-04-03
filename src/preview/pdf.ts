import { registerPreviewer } from "./index";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

registerPreviewer({
  extensions: ["pdf"],
  render(_content, filePath, element) {
    element.innerHTML = `<div style="text-align: center; color: #888; padding: 20px;">Loading PDF...</div>`;

    // Read as base64, convert to Uint8Array
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

      // Render each page
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 1.5;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.maxWidth = "100%";
        canvas.style.borderRadius = "4px";
        canvas.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        element.appendChild(canvas);
      }
    }).catch((err) => {
      element.innerHTML = `<div style="color: #f85149; padding: 20px;">Failed to load PDF: ${err}</div>`;
    });
  },
});
