import { describe, it, expect, vi } from "vitest";
import { get } from "svelte/store";
import {
  resolveAuthConfig,
  validateAuth,
  createAuthStore,
} from "../auth-store";
import type { SpacebaseClient, MeResponse } from "../api-client";
import { SpacebaseError } from "../api-client";

function fakeClient(overrides: Partial<SpacebaseClient> = {}): SpacebaseClient {
  return {
    me: vi.fn().mockResolvedValue({
      type: "api_key",
      projects: [{ id: "proj_1", name: "Demo" }],
    } satisfies MeResponse),
    listDocs: vi.fn().mockResolvedValue([]),
    getDoc: vi.fn(),
    getDocRaw: vi.fn(),
    ...overrides,
  };
}

describe("resolveAuthConfig", () => {
  it("reads apiKey/baseUrl/projectId from settings", () => {
    const cfg = resolveAuthConfig(
      {
        apiKey: "sw_settings",
        baseUrl: "https://staging.thegnar.com",
        projectId: "proj_x",
      },
      {},
    );
    expect(cfg).toEqual({
      apiKey: "sw_settings",
      baseUrl: "https://staging.thegnar.com",
      projectId: "proj_x",
    });
  });

  it("falls back to env vars when settings are blank", () => {
    const cfg = resolveAuthConfig(
      { apiKey: "", baseUrl: "", projectId: "" },
      {
        SPACEBASE_API_KEY: "sw_env",
        SPACEBASE_URL: "https://env.thegnar.com",
        SPACEBASE_PROJECT_ID: "proj_env",
      },
    );
    expect(cfg).toEqual({
      apiKey: "sw_env",
      baseUrl: "https://env.thegnar.com",
      projectId: "proj_env",
    });
  });

  it("settings win over env vars when both are present", () => {
    const cfg = resolveAuthConfig(
      { apiKey: "sw_settings", baseUrl: "https://settings.tld", projectId: "" },
      {
        SPACEBASE_API_KEY: "sw_env",
        SPACEBASE_URL: "https://env.tld",
        SPACEBASE_PROJECT_ID: "proj_env",
      },
    );
    expect(cfg.apiKey).toBe("sw_settings");
    expect(cfg.baseUrl).toBe("https://settings.tld");
    // projectId blank in settings → env fallback applies
    expect(cfg.projectId).toBe("proj_env");
  });

  it("defaults baseUrl to https://spacebase.thegnar.com when neither is set", () => {
    const cfg = resolveAuthConfig(
      { apiKey: "sw_test", baseUrl: "", projectId: "" },
      {},
    );
    expect(cfg.baseUrl).toBe("https://spacebase.thegnar.com");
  });
});

describe("validateAuth", () => {
  it("returns valid + projects on a successful /me", async () => {
    const client = fakeClient({
      me: vi.fn().mockResolvedValue({
        type: "api_key" as const,
        projects: [
          { id: "proj_1", name: "One" },
          { id: "proj_2", name: "Two" },
        ],
      }),
    });
    const status = await validateAuth(client, "");
    expect(status.kind).toBe("valid");
    if (status.kind !== "valid") return;
    expect(status.projects).toEqual([
      { id: "proj_1", name: "One" },
      { id: "proj_2", name: "Two" },
    ]);
  });

  it("when configuredProjectId matches an accessible project, exposes it as resolvedProjectId", async () => {
    const client = fakeClient({
      me: vi.fn().mockResolvedValue({
        type: "api_key" as const,
        projects: [
          { id: "proj_1", name: "One" },
          { id: "proj_2", name: "Two" },
        ],
      }),
    });
    const status = await validateAuth(client, "proj_2");
    if (status.kind !== "valid") throw new Error("expected valid");
    expect(status.resolvedProjectId).toBe("proj_2");
  });

  it("when only one project is accessible, resolves it even without configuredProjectId", async () => {
    const client = fakeClient({
      me: vi.fn().mockResolvedValue({
        type: "api_key" as const,
        projects: [{ id: "proj_solo", name: "Solo" }],
      }),
    });
    const status = await validateAuth(client, "");
    if (status.kind !== "valid") throw new Error("expected valid");
    expect(status.resolvedProjectId).toBe("proj_solo");
  });

  it("when configuredProjectId is missing and multiple projects are accessible, leaves resolvedProjectId null", async () => {
    const client = fakeClient({
      me: vi.fn().mockResolvedValue({
        type: "api_key" as const,
        projects: [
          { id: "proj_1", name: "One" },
          { id: "proj_2", name: "Two" },
        ],
      }),
    });
    const status = await validateAuth(client, "");
    if (status.kind !== "valid") throw new Error("expected valid");
    expect(status.resolvedProjectId).toBeNull();
  });

  it("returns invalid with status on 401 from /me", async () => {
    const client = fakeClient({
      me: vi
        .fn()
        .mockRejectedValue(
          new SpacebaseError("unauthorized", 401, "unauthorized"),
        ),
    });
    const status = await validateAuth(client, "");
    expect(status.kind).toBe("invalid");
    if (status.kind !== "invalid") return;
    expect(status.status).toBe(401);
    expect(status.message).toContain("unauthorized");
  });

  it("returns invalid with status 0 on a network error", async () => {
    const client = fakeClient({
      me: vi
        .fn()
        .mockRejectedValue(
          new SpacebaseError("network error: offline", 0, "network_error"),
        ),
    });
    const status = await validateAuth(client, "");
    expect(status.kind).toBe("invalid");
    if (status.kind !== "invalid") return;
    expect(status.status).toBe(0);
  });
});

describe("createAuthStore", () => {
  it("starts in not-configured when apiKey is empty", async () => {
    const meSpy = vi.fn();
    const store = createAuthStore({
      getConfig: () => ({
        apiKey: "",
        baseUrl: "https://spacebase.thegnar.com",
        projectId: "",
      }),
      makeClient: () => fakeClient({ me: meSpy }),
    });
    await store.refresh();
    const v = get(store.status);
    expect(v.kind).toBe("not-configured");
    expect(meSpy).not.toHaveBeenCalled();
  });

  it("reaches valid after a successful /me", async () => {
    const meSpy = vi.fn().mockResolvedValue({
      type: "api_key" as const,
      projects: [{ id: "proj_1", name: "Demo" }],
    });
    const store = createAuthStore({
      getConfig: () => ({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com",
        projectId: "",
      }),
      makeClient: () => fakeClient({ me: meSpy }),
    });
    await store.refresh();
    const v = get(store.status);
    expect(v.kind).toBe("valid");
    expect(meSpy).toHaveBeenCalledTimes(1);
  });

  it("reaches invalid on a failed /me", async () => {
    const store = createAuthStore({
      getConfig: () => ({
        apiKey: "sw_bad",
        baseUrl: "https://spacebase.thegnar.com",
        projectId: "",
      }),
      makeClient: () =>
        fakeClient({
          me: vi
            .fn()
            .mockRejectedValue(
              new SpacebaseError("forbidden", 403, "forbidden"),
            ),
        }),
    });
    await store.refresh();
    const v = get(store.status);
    expect(v.kind).toBe("invalid");
  });
});
