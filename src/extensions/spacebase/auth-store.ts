/**
 * Auth state machine for the Spacebase extension.
 *
 * Pure module — takes config + a client factory and exposes a
 * `Readable<AuthStatus>` plus a `refresh()` action. The extension wires
 * this to `api.getSetting` / env vars at activate time.
 */
import { writable, type Readable } from "svelte/store";
import type {
  SpacebaseClient,
  SpacebaseProjectRef,
  MeResponse,
} from "./api-client";
import { SpacebaseError } from "./api-client";

export type AuthStatus =
  | { kind: "not-configured"; reason: string }
  | { kind: "checking" }
  | {
      kind: "valid";
      projects: SpacebaseProjectRef[];
      resolvedProjectId: string | null;
    }
  | { kind: "invalid"; status: number; message: string };

export type AuthConfig = {
  apiKey: string;
  baseUrl: string;
  projectId: string;
};

export type AuthEnv = {
  SPACEBASE_API_KEY?: string;
  SPACEBASE_URL?: string;
  SPACEBASE_PROJECT_ID?: string;
};

const DEFAULT_BASE_URL = "https://spacebase.thegnar.com";

export function resolveAuthConfig(
  settings: Record<string, unknown>,
  env: AuthEnv = {},
): AuthConfig {
  const apiKey =
    pickString(settings.apiKey) || env.SPACEBASE_API_KEY?.trim() || "";
  const baseUrl =
    pickString(settings.baseUrl) ||
    env.SPACEBASE_URL?.trim() ||
    DEFAULT_BASE_URL;
  const projectId =
    pickString(settings.projectId) || env.SPACEBASE_PROJECT_ID?.trim() || "";
  return { apiKey, baseUrl, projectId };
}

function pickString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Validate an already-built client by hitting `/me`. Caller is
 * responsible for refusing to construct a client with an empty apiKey —
 * see `createAuthStore` for the gating logic.
 */
export async function validateAuth(
  client: SpacebaseClient,
  configuredProjectId: string,
): Promise<AuthStatus> {
  let me: MeResponse;
  try {
    me = await client.me();
  } catch (err) {
    if (err instanceof SpacebaseError) {
      return { kind: "invalid", status: err.status, message: err.message };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "invalid", status: 0, message: msg };
  }
  const projects = me.projects ?? [];
  const resolvedProjectId = pickResolvedProjectId(
    projects,
    configuredProjectId,
  );
  return { kind: "valid", projects, resolvedProjectId };
}

function pickResolvedProjectId(
  projects: SpacebaseProjectRef[],
  configured: string,
): string | null {
  if (configured) {
    const match = projects.find((p) => p.id === configured);
    if (match) return match.id;
  }
  const sole = projects.length === 1 ? projects[0] : undefined;
  return sole ? sole.id : null;
}

export type AuthStoreDeps = {
  getConfig: () => AuthConfig;
  makeClient: (cfg: AuthConfig) => SpacebaseClient;
};

export type AuthStore = {
  status: Readable<AuthStatus>;
  refresh: () => Promise<void>;
};

export function createAuthStore(deps: AuthStoreDeps): AuthStore {
  const status = writable<AuthStatus>({
    kind: "not-configured",
    reason: "API key not set",
  });
  async function refresh(): Promise<void> {
    const cfg = deps.getConfig();
    if (!cfg.apiKey) {
      status.set({ kind: "not-configured", reason: "API key not set" });
      return;
    }
    status.set({ kind: "checking" });
    const client = deps.makeClient(cfg);
    const next = await validateAuth(client, cfg.projectId);
    status.set(next);
  }
  return { status: { subscribe: status.subscribe }, refresh };
}
