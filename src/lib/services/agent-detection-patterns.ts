/**
 * agent-detection-patterns — pure pattern matching + surface lookups.
 *
 * Owns the AgentPattern shape, the DEFAULT_PATTERNS list, and the
 * `matchesPattern` regex cache. Also owns the surface-level lookup
 * helpers (`allTerminalSurfaces`, `classifyFromSurfaceCommand`,
 * `resolveWorkspaceIdForSurface`, `resolvePtyIdForSurface`) because
 * pattern matching against PTY titles and argv is the primary detection
 * signal — keeping the regex + surface lookups together avoids a
 * needless third slice.
 *
 * No mutable state lives here. All exports are pure functions or static
 * data.
 */
import { get } from "svelte/store";
import { getConfig } from "../config";
import { type AgentType, parseAgentTypeFromArgv } from "./agent-type";
import { workspaces } from "../stores/workspace";
import { getAllPanes, isTerminalSurface } from "../types";
import {
  lookupSurfaceWorkspaceId,
  lookupPtyIdForSurface,
} from "./service-helpers";

export interface AgentPattern {
  name: string;
  titlePatterns: string[];
  oscDetectable: boolean;
  /** Typed agent classification. Omit to fall back to "generic". */
  agentType?: AgentType;
}

export const DEFAULT_PATTERNS: AgentPattern[] = [
  {
    name: "Claude Code",
    titlePatterns: ["claude"],
    oscDetectable: true,
    agentType: "claude",
  },
  {
    name: "Codex",
    titlePatterns: ["codex"],
    oscDetectable: true,
    agentType: "codex",
  },
  {
    name: "Gemini",
    titlePatterns: ["gemini"],
    oscDetectable: false,
    agentType: "gemini",
  },
  {
    name: "Goose",
    titlePatterns: ["goose"],
    oscDetectable: false,
    agentType: "goose",
  },
  {
    name: "Aider",
    titlePatterns: ["aider"],
    oscDetectable: true,
    agentType: "aider",
  },
  {
    name: "OpenCode",
    titlePatterns: ["opencode"],
    oscDetectable: false,
    agentType: "opencode",
  },
  {
    name: "Cline",
    titlePatterns: ["cline"],
    oscDetectable: false,
    agentType: "cline",
  },
  {
    name: "Amp",
    titlePatterns: ["amp"],
    oscDetectable: false,
    agentType: "amp",
  },
  {
    name: "Cursor Agent",
    titlePatterns: ["cursor"],
    oscDetectable: false,
    agentType: "cursor-agent",
  },
  {
    name: "GitHub Copilot",
    titlePatterns: ["ghcs", "github-copilot"],
    oscDetectable: false,
    // No agentType — intentionally "generic" fallback
  },
];

const _patternRegexCache = new WeakMap<AgentPattern, RegExp>();

function getPatternRegex(pattern: AgentPattern): RegExp {
  let regex = _patternRegexCache.get(pattern);
  if (!regex) {
    const escaped = pattern.titlePatterns.map((p) =>
      p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    // eslint-disable-next-line security/detect-non-literal-regexp
    regex = new RegExp(escaped.join("|"), "i");
    _patternRegexCache.set(pattern, regex);
  }
  return regex;
}

export function matchesPattern(
  text: string,
  patterns: AgentPattern[],
): AgentPattern | null {
  for (const pattern of patterns) {
    if (getPatternRegex(pattern).test(text)) {
      return pattern;
    }
  }
  return null;
}

export function loadPatternList(): AgentPattern[] {
  const patterns = [...DEFAULT_PATTERNS];
  const config = getConfig();
  // `agentDetection` is the canonical field name; fall back to the old
  // `agents` object shape for configs that haven't been migrated yet
  // (cycle-1 coexistence guard).
  const userPatterns =
    config.agentDetection?.knownAgents ??
    (config as unknown as Record<string, { knownAgents?: unknown }>).agents
      ?.knownAgents;
  if (Array.isArray(userPatterns)) {
    for (const p of userPatterns) {
      if (p.name && Array.isArray(p.titlePatterns)) {
        patterns.push({
          name: p.name,
          titlePatterns: p.titlePatterns,
          oscDetectable: p.oscDetectable ?? false,
        });
      }
    }
  }
  return patterns;
}

export function loadIdleTimeoutMs(): number {
  const config = getConfig();
  // Same coexistence fallback as loadPatternList.
  const raw =
    config.agentDetection?.idleTimeout ??
    (config as unknown as Record<string, { idleTimeout?: unknown }>).agents
      ?.idleTimeout;
  const seconds = typeof raw === "number" && raw > 0 ? raw : 30;
  return seconds * 1000;
}

export function resolveWorkspaceIdForSurface(surfaceId: string): string {
  return lookupSurfaceWorkspaceId(surfaceId) ?? "";
}

export function resolvePtyIdForSurface(surfaceId: string): number | null {
  const ptyId = lookupPtyIdForSurface(surfaceId);
  return ptyId !== undefined ? ptyId : null;
}

export function allTerminalSurfaces(): Array<{
  id: string;
  title: string;
  workspaceId: string;
  paneId: string;
}> {
  const all = get(workspaces);
  const out: Array<{
    id: string;
    title: string;
    workspaceId: string;
    paneId: string;
  }> = [];
  for (const ws of all) {
    for (const pane of getAllPanes(ws.paneLayout)) {
      for (const surface of pane.surfaces) {
        if (isTerminalSurface(surface)) {
          out.push({
            id: surface.id,
            title: surface.title,
            workspaceId: ws.id,
            paneId: pane.id,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Look up the startupCommand / definedCommand recorded on the terminal
 * surface. Returns the first non-empty value or null. Used by the
 * argv-based classifier — surface commands are the only argv source on
 * a TrackedSurface (the PTY spawn flow doesn't pass argv into the
 * detection service directly).
 */
function lookupSurfaceCommand(surfaceId: string): string | null {
  const all = get(workspaces);
  for (const ws of all) {
    for (const pane of getAllPanes(ws.paneLayout)) {
      for (const surface of pane.surfaces) {
        if (surface.id === surfaceId && isTerminalSurface(surface)) {
          return surface.startupCommand || surface.definedCommand || null;
        }
      }
    }
  }
  return null;
}

/** Tokenize a shell-ish command into argv0 + argv. Splits on whitespace
 *  without quote-awareness — sufficient for binary-name extraction. */
function splitCommandToArgv(cmd: string): { argv0: string; argv: string[] } {
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  const argv0 = tokens[0] ?? "";
  const argv = tokens.slice(1);
  return { argv0, argv };
}

/**
 * Look up the surface's spawn-time command (if any) and classify the
 * agent type from its argv. Returns null when there is no command or
 * the command does not match any known agent binary.
 */
export function classifyFromSurfaceCommand(
  surfaceId: string,
): AgentType | null {
  const cmd = lookupSurfaceCommand(surfaceId);
  if (!cmd) return null;
  const { argv0, argv } = splitCommandToArgv(cmd);
  return parseAgentTypeFromArgv(argv0, argv);
}
