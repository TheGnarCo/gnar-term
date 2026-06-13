/**
 * The MCP tool registry. Tool modules call `registerTool` at import time; the
 * transport and test hooks read the registry via `getTools`.
 *
 * This is a leaf module (no store / handler imports), so tool modules can
 * import it without creating a cycle.
 */
import type { ToolDef } from "./types";

const TOOLS: ToolDef[] = [];

export function registerTool(t: ToolDef): void {
  TOOLS.push(t);
}

export function getTools(): ToolDef[] {
  return TOOLS;
}
