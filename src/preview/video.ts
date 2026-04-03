import { registerPreviewer } from "./index";
import { convertFileSrc } from "@tauri-apps/api/core";

registerPreviewer({
  extensions: ["mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv"],
  render(_content, filePath, element) {
    const src = convertFileSrc(filePath);
    element.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; min-height: 200px;">
        <video src="${src}" controls autoplay
          style="max-width: 100%; max-height: 80vh; border-radius: 4px;"
          onerror="this.parentElement.innerHTML='<div style=color:#f85149>Failed to load video</div>'" />
      </div>
    `;
  },
});
