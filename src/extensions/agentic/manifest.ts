import type { ExtensionManifest } from "../api";

export const agenticManifest: ExtensionManifest = {
  id: "agentic",
  name: "Agentic",
  version: "0.1.0",
  description:
    "Agentic Dashboard — agent board, branch lifecycle swimlanes, attention inbox, and spawn-agentic-branch flow over the agentic-core substrate.",
  entry: "./index.ts",
  included: true,
  defaultEnabled: true,
  contributes: {},
};
