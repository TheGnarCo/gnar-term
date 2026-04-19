/**
 * Preview Registry — entirely extension-owned.
 *
 * The preview extension owns the full preview pipeline: file type detection,
 * content rendering, and surface management. Core has no knowledge of
 * preview functionality.
 */

export interface PreviewResult {
  id: string;
  filePath: string;
  title: string;
  element: HTMLElement;
  watchId: number;
  dispose?: () => void;
}

/**
 * Context passed to previewer render functions — provides API-sourced
 * dependencies so previewers never import from @tauri-apps or core stores.
 */
export interface PreviewContext {
  theme: {
    bg: string;
    fg: string;
    fgDim: string;
    bgSurface: string;
    bgHighlight: string;
    border: string;
    ansi: {
      blue: string;
      green: string;
      yellow: string;
      magenta: string;
      [key: string]: string;
    };
    [key: string]: unknown;
  };
  convertFileSrc(path: string): string;
  invoke<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
}

export interface Previewer {
  extensions: string[];
  render(
    content: string,
    filePath: string,
    element: HTMLElement,
    ctx?: PreviewContext,
  ): void;
}

// --- Registry ---

const previewers: Previewer[] = [];

export function registerPreviewer(previewer: Previewer) {
  previewers.push(previewer);
}

export function clearPreviewers() {
  previewers.length = 0;
}

export function canPreview(filePath: string): boolean {
  const ext = getExtension(filePath);
  return previewers.some((p) => p.extensions.includes(ext));
}

export function getSupportedExtensions(): string[] {
  return previewers.flatMap((p) => p.extensions);
}

export function getExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export function findPreviewer(filePath: string): Previewer | undefined {
  const ext = getExtension(filePath);
  return previewers.find((p) => p.extensions.includes(ext));
}
