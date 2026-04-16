import { registerPreviewer } from "../preview-registry";

registerPreviewer({
  extensions: ["mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv"],
  render(_content, filePath, element, ctx) {
    const src = ctx!.convertFileSrc(filePath);
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "display: flex; justify-content: center; align-items: center; min-height: 200px;";
    const video = document.createElement("video");
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText =
      "max-width: 100%; max-height: 80vh; border-radius: 4px;";
    video.onerror = () => {
      wrapper.textContent = "";
      const errDiv = document.createElement("div");
      errDiv.style.color = "#f85149";
      errDiv.textContent = "Failed to load video";
      wrapper.appendChild(errDiv);
    };
    wrapper.appendChild(video);
    element.textContent = "";
    element.appendChild(wrapper);
  },
});
