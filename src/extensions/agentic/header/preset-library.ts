import type { ExtensionAPI } from "../../api";

/**
 * Route the user to the Settings panel, Agents tab if possible.
 *
 * The only registered settings command in core is `"core.open-settings"`.
 * We first try passing `{ tab: "agents" }` as args; if the command isn't
 * registered (returns false), we retry without args. If both fail, we
 * surface a reportError so the user knows what happened.
 */
export function openPresetLibrary(api: ExtensionAPI): void {
  const opened = api.runCommand("core.open-settings", { tab: "agents" });
  if (opened) return;

  const openedFallback = api.runCommand("core.open-settings");
  if (openedFallback) return;

  api.reportError(
    "Cannot open Settings — no open-settings command registered.",
  );
}
