import { registerPreviewer } from "./index";
import { convertFileSrc } from "@tauri-apps/api/core";

registerPreviewer({
  extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"],
  render(_content, filePath, element) {
    const src = convertFileSrc(filePath);
    element.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; min-height: 200px;">
        <img src="${src}" alt="${filePath}" 
          style="max-width: 100%; max-height: 80vh; border-radius: 4px;"
          onerror="this.parentElement.innerHTML='<div style=color:#f85149>Failed to load image</div>'" />
      </div>
    `;
  },
});
