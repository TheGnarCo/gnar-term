import { registerPreviewer } from "./index";
import { convertFileSrc } from "@tauri-apps/api/core";

registerPreviewer({
  extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "heic", "heif", "tiff", "tif", "avif"],
  render(_content, filePath, element) {
    const src = convertFileSrc(filePath);
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "display: flex; justify-content: center; align-items: center; min-height: 200px;";
    const img = document.createElement("img");
    img.src = src;
    img.alt = filePath;
    img.style.cssText = "max-width: 100%; max-height: 80vh; border-radius: 4px;";
    img.onerror = () => {
      wrapper.textContent = "";
      const errDiv = document.createElement("div");
      errDiv.style.color = "#f85149";
      errDiv.textContent = "Failed to load image";
      wrapper.appendChild(errDiv);
    };
    wrapper.appendChild(img);
    element.textContent = "";
    element.appendChild(wrapper);
  },
});
