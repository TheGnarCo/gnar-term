import { registerPreviewer } from "./index";
import { invoke } from "@tauri-apps/api/core";

registerPreviewer({
  extensions: ["pdf"],
  render(_content, filePath, element) {
    element.innerHTML = `<div style="text-align: center; color: #888; padding: 20px;">Loading PDF...</div>`;
    element.style.padding = "0";

    // Track the URL/iframe created asynchronously so the cleanup callback can
    // revoke the Blob URL even if teardown races ahead of the file read.
    let blobUrl: string | undefined;
    let iframe: HTMLIFrameElement | undefined;
    let disposed = false;

    invoke<string>("read_file_base64", { path: filePath }).then((b64) => {
      if (disposed) return;
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      blobUrl = URL.createObjectURL(blob);

      element.innerHTML = "";
      element.style.height = "100%";
      element.style.padding = "0";

      iframe = document.createElement("iframe");
      iframe.src = blobUrl;
      iframe.style.cssText = "width: 100%; height: 100%; border: none;";
      element.appendChild(iframe);
    }).catch((err) => {
      if (disposed) return;
      element.innerHTML = `<div style="color: #f85149; padding: 20px;">Failed to load PDF: ${err}</div>`;
    });

    return () => {
      disposed = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      iframe?.remove();
    };
  },
});
