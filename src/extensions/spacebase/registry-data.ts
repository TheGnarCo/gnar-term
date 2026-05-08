/**
 * Registry surface helpers — pure data layer, no Svelte.
 *
 * The Svelte component imports `openDocFlow` and binds the host-side
 * dependencies (`ensureDir`, `writeFile`, `openPreviewSplit`, `getHome`)
 * via the `ExtensionAPI`. Keeping the flow here lets us test the
 * fetch → write → preview sequence without rendering anything.
 */
import type { SpacebaseClient } from "./api-client";

const CACHE_SEGMENT = ".gnar-term/spacebase/cache";

export function cachePathFor(
  home: string,
  projectId: string,
  docId: string,
): string {
  const root = home.replace(/\/+$/, "");
  return `${root}/${CACHE_SEGMENT}/${projectId}/${docId}.md`;
}

export type OpenDocFlowDeps = {
  client: SpacebaseClient;
  ensureDir: (path: string) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
  openPreviewSplit: (path: string) => void;
  getHome: () => Promise<string>;
};

export async function openDocFlow(
  deps: OpenDocFlowDeps,
  projectId: string,
  docId: string,
): Promise<void> {
  const raw = await deps.client.getDocRaw(projectId, docId);
  const home = await deps.getHome();
  const dir = `${home.replace(/\/+$/, "")}/${CACHE_SEGMENT}/${projectId}`;
  await deps.ensureDir(dir);
  const path = cachePathFor(home, projectId, docId);
  await deps.writeFile(path, raw);
  deps.openPreviewSplit(path);
}
