import { describe, it, expect, vi } from "vitest";
import { createSpacebaseClient, SpacebaseError } from "../api-client";

// All Spacebase calls are blocked by the network sandbox in tests, so we
// inject a mock fetch via the constructor rather than monkey-patching globals.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/markdown" },
  });
}

function errorResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createSpacebaseClient", () => {
  describe("URL + auth wiring", () => {
    it("strips a trailing slash from baseUrl when building request URLs", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ type: "api_key", projects: [] }));
      const client = createSpacebaseClient({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com/",
        fetch: fetchMock,
      });
      await client.me();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://spacebase.thegnar.com/api/v1/me");
    });

    it("sends Authorization: Bearer <apiKey> on every request", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ type: "api_key", projects: [] }));
      const client = createSpacebaseClient({
        apiKey: "sw_secret",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      await client.me();
      const [, init] = fetchMock.mock.calls[0];
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer sw_secret");
    });

    it("sends Accept: application/json for JSON endpoints", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ type: "api_key", projects: [] }));
      const client = createSpacebaseClient({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      await client.me();
      const [, init] = fetchMock.mock.calls[0];
      const headers = new Headers(init.headers);
      expect(headers.get("accept")).toBe("application/json");
    });
  });

  describe("me()", () => {
    it("GETs /api/v1/me and returns the parsed body", async () => {
      const body = {
        type: "api_key" as const,
        projects: [{ id: "proj_1", name: "Demo" }],
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
      const client = createSpacebaseClient({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      const result = await client.me();
      expect(result).toEqual(body);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://spacebase.thegnar.com/api/v1/me");
      expect(init.method ?? "GET").toBe("GET");
    });
  });

  describe("listDocs()", () => {
    it("GETs /api/v1/projects/{id}/docs and returns the array", async () => {
      const body = [
        {
          id: "doc_1",
          project_id: "proj_1",
          title: "Hello",
          folder_path: "",
          locked: false,
          created_by: "user_1",
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
      const client = createSpacebaseClient({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      const result = await client.listDocs("proj_1");
      expect(result).toEqual(body);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://spacebase.thegnar.com/api/v1/projects/proj_1/docs",
      );
    });
  });

  describe("getDoc()", () => {
    it("GETs /api/v1/projects/{id}/docs/{docId}", async () => {
      const body = {
        id: "doc_1",
        project_id: "proj_1",
        title: "Hello",
        folder_path: "",
        locked: false,
        created_by: "user_1",
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        content: "# Hello",
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
      const client = createSpacebaseClient({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      const result = await client.getDoc("proj_1", "doc_1");
      expect(result).toEqual(body);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://spacebase.thegnar.com/api/v1/projects/proj_1/docs/doc_1",
      );
    });
  });

  describe("getDocRaw()", () => {
    it("GETs /api/v1/projects/{id}/docs/{docId}/raw and returns text", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(textResponse("# Markdown body\n"));
      const client = createSpacebaseClient({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      const result = await client.getDocRaw("proj_1", "doc_1");
      expect(result).toBe("# Markdown body\n");
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://spacebase.thegnar.com/api/v1/projects/proj_1/docs/doc_1/raw",
      );
    });
  });

  describe("error handling", () => {
    it("throws SpacebaseError with status on 401", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(errorResponse(401, { message: "unauthorized" }));
      const client = createSpacebaseClient({
        apiKey: "sw_bad",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      await expect(client.me()).rejects.toBeInstanceOf(SpacebaseError);
      await expect(client.me()).rejects.toMatchObject({ status: 401 });
    });

    it("throws SpacebaseError with status on 404", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(errorResponse(404, { message: "not found" }));
      const client = createSpacebaseClient({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      await expect(client.getDoc("proj_1", "missing")).rejects.toMatchObject({
        status: 404,
      });
    });

    it("wraps fetch network errors as SpacebaseError", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
      const client = createSpacebaseClient({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      await expect(client.me()).rejects.toBeInstanceOf(SpacebaseError);
    });

    it("SpacebaseError carries status, code, and message fields", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          errorResponse(403, { code: "forbidden", message: "no access" }),
        );
      const client = createSpacebaseClient({
        apiKey: "sw_test",
        baseUrl: "https://spacebase.thegnar.com",
        fetch: fetchMock,
      });
      try {
        await client.listDocs("proj_1");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(SpacebaseError);
        const e = err as SpacebaseError;
        expect(e.status).toBe(403);
        expect(e.code).toBe("forbidden");
        expect(e.message).toContain("no access");
      }
    });
  });
});
