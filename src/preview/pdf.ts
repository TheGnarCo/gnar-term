import { registerPreviewer } from "./index";
import { invoke } from "@tauri-apps/api/core";
import "pdfjs-viewer-element";

registerPreviewer({
  extensions: ["pdf"],
  render(_content, filePath, element) {
    element.innerHTML = `<div style="text-align: center; color: #888; padding: 20px;">Loading PDF...</div>`;

    invoke<string>("read_file_base64", { path: filePath }).then((b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      element.innerHTML = "";
      element.style.padding = "0";

      const viewer = document.createElement("pdfjs-viewer-element") as any;
      viewer.setAttribute("src", url);
      viewer.style.cssText = "width: 100%; height: 100%; display: block;";
      element.appendChild(viewer);
    }).catch((err) => {
      element.innerHTML = `<div style="color: #f85149; padding: 20px;">Failed to load PDF: ${err}</div>`;
    });
  },
});
