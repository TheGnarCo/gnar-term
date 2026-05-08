/**
 * Spacebase HTTP client.
 *
 * Pure functions over `fetch`. The constructor accepts an optional `fetch`
 * override so tests (and the network sandbox, which blocks `*.thegnar.com`)
 * can supply a mock without monkey-patching globals.
 *
 * Endpoint reference:
 * `~/.claude/plugins/marketplaces/gnar/spacebase/skills/spacebase-api/references/api-endpoints.md`
 */

export type SpacebaseProjectRef = { id: string; name: string };

export type MeResponse =
  | {
      type: "api_key";
      project?: SpacebaseProjectRef | null;
      projects: SpacebaseProjectRef[];
    }
  | {
      type: "user_token";
      user: {
        id: string;
        username: string;
        display_name: string;
        role: string;
      };
      scopes?: {
        client_ids: string[] | null;
        project_ids: string[] | null;
      } | null;
      projects: SpacebaseProjectRef[];
    }
  | {
      type: "session";
      user: {
        id: string;
        username: string;
        display_name: string;
        role: string;
        client_id?: string;
      };
      projects: SpacebaseProjectRef[];
    };

export type DocSummary = {
  id: string;
  project_id: string;
  title: string;
  folder_path: string;
  locked: boolean;
  created_by: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
};

export type Doc = DocSummary & { content: string };

export type SpacebaseClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
};

export type SpacebaseClient = {
  me(): Promise<MeResponse>;
  listDocs(projectId: string): Promise<DocSummary[]>;
  getDoc(projectId: string, docId: string): Promise<Doc>;
  getDocRaw(projectId: string, docId: string): Promise<string>;
};

export class SpacebaseError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SpacebaseError";
    this.status = status;
    this.code = code;
  }
}

export function createSpacebaseClient(
  opts: SpacebaseClientOptions,
): SpacebaseClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const root = opts.baseUrl.replace(/\/+$/, "");
  const auth = `Bearer ${opts.apiKey}`;

  async function request(path: string, accept: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${root}${path}`, {
        method: "GET",
        headers: {
          authorization: auth,
          accept,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SpacebaseError(`network error: ${msg}`, 0, "network_error");
    }
    if (!res.ok) {
      let code: string | undefined;
      let detail = res.statusText || `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { code?: string; message?: string };
        if (body && typeof body === "object") {
          if (typeof body.code === "string") code = body.code;
          if (typeof body.message === "string") detail = body.message;
        }
      } catch {
        // Non-JSON error body — fall back to statusText.
      }
      throw new SpacebaseError(detail, res.status, code);
    }
    return res;
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await request(path, "application/json");
    return (await res.json()) as T;
  }

  async function getText(path: string): Promise<string> {
    const res = await request(path, "text/markdown");
    return await res.text();
  }

  return {
    me() {
      return getJson<MeResponse>("/api/v1/me");
    },
    listDocs(projectId) {
      return getJson<DocSummary[]>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/docs`,
      );
    },
    getDoc(projectId, docId) {
      return getJson<Doc>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(docId)}`,
      );
    },
    getDocRaw(projectId, docId) {
      return getText(
        `/api/v1/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(docId)}/raw`,
      );
    },
  };
}
