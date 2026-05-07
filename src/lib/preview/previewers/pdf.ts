import { registerPreviewer } from "../../services/preview-registry";

registerPreviewer({
  extensions: ["pdf"],
  render(_content, filePath, element, ctx) {
    element.textContent = "Loading PDF...";
    element.style.padding = "0";

    // Track the URL/iframe asynchronously created in the .then() block so
    // the dispose callback can revoke the Blob URL even if teardown races
    // ahead of the read_file_base64 resolution.
    let blobUrl: string | undefined;
    let iframe: HTMLIFrameElement | undefined;
    let disposed = false;

    ctx!
      .invoke<string>("read_file_base64", { path: filePath })
      .then((b64) => {
        if (disposed) return;
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        blobUrl = URL.createObjectURL(blob);

        element.textContent = "";
        element.style.height = "100%";
        element.style.padding = "0";

        iframe = document.createElement("iframe");
        iframe.src = blobUrl;
        iframe.style.cssText = "width: 100%; height: 100%; border: none;";
        element.appendChild(iframe);
      })
      .catch((err) => {
        if (disposed) return;
        element.textContent = "";
        const errDiv = document.createElement("div");
        errDiv.style.cssText = "color: #f85149; padding: 20px;";
        errDiv.textContent = `Failed to load PDF: ${err}`;
        element.appendChild(errDiv);
      });

    return () => {
      disposed = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      iframe?.remove();
    };
  },
});
