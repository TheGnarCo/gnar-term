import { registerPreviewer } from "./index";
import { invoke } from "@tauri-apps/api/core";

registerPreviewer({
  extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"],
  render(_content, filePath, element) {
    // Read as base64 from Rust and display as data URL
    element.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; min-height: 200px; color: #666;">
        Loading...
      </div>
    `;
    invoke<string>("read_file_base64", { path: filePath }).then((b64) => {
      const ext = filePath.split(".").pop()?.toLowerCase() || "png";
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp" }[ext] || "image/png";
      element.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 200px;">
          <img src="data:${mime};base64,${b64}" alt="${filePath}" style="max-width: 100%; max-height: 80vh; border-radius: 4px;" />
        </div>
      `;
    }).catch((err) => {
      element.innerHTML = `<div style="color: #f85149;">Failed to load image: ${err}</div>`;
    });
  },
});
