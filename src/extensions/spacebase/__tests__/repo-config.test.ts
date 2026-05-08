/**
 * Pins the on-disk shape of `.gnar-term/spacebase.json` and the
 * load/write/parse semantics. These tests use an in-memory fake fs so
 * they don't rely on Tauri.
 */
import { describe, it, expect } from "vitest";
import {
  loadRepoConfig,
  repoConfigPath,
  writeRepoConfig,
  type RepoConfigDeps,
} from "../repo-config";

function makeFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const dirs = new Set<string>();
  const deps: RepoConfigDeps = {
    fileExists: async (p) => files.has(p),
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFile: async (p, c) => {
      files.set(p, c);
    },
    ensureDir: async (p) => {
      dirs.add(p);
    },
  };
  return { deps, files, dirs };
}

describe("repoConfigPath", () => {
  it("places the config under the repo's .gnar-term/ directory", () => {
    expect(repoConfigPath("/Users/me/projects/foo")).toBe(
      "/Users/me/projects/foo/.gnar-term/spacebase.json",
    );
  });

  it("normalizes a trailing slash on the workspace path", () => {
    expect(repoConfigPath("/Users/me/projects/foo/")).toBe(
      "/Users/me/projects/foo/.gnar-term/spacebase.json",
    );
  });
});

describe("loadRepoConfig", () => {
  it("returns null when no config file exists", async () => {
    const { deps } = makeFs();
    expect(await loadRepoConfig(deps, "/repo")).toBeNull();
  });

  it("parses a projectId string", async () => {
    const { deps } = makeFs({
      "/repo/.gnar-term/spacebase.json": JSON.stringify({ projectId: "p_42" }),
    });
    expect(await loadRepoConfig(deps, "/repo")).toEqual({ projectId: "p_42" });
  });

  it("treats an empty-string projectId as unset", async () => {
    const { deps } = makeFs({
      "/repo/.gnar-term/spacebase.json": JSON.stringify({ projectId: "" }),
    });
    expect(await loadRepoConfig(deps, "/repo")).toEqual({
      projectId: undefined,
    });
  });

  it("returns null for malformed JSON (no throw)", async () => {
    const { deps } = makeFs({
      "/repo/.gnar-term/spacebase.json": "{not json",
    });
    expect(await loadRepoConfig(deps, "/repo")).toBeNull();
  });

  it("ignores non-string projectId fields", async () => {
    const { deps } = makeFs({
      "/repo/.gnar-term/spacebase.json": JSON.stringify({ projectId: 123 }),
    });
    expect(await loadRepoConfig(deps, "/repo")).toEqual({
      projectId: undefined,
    });
  });
});

describe("writeRepoConfig", () => {
  it("creates .gnar-term/ and writes a 2-space JSON file with trailing newline", async () => {
    const { deps, files, dirs } = makeFs();
    await writeRepoConfig(deps, "/repo", { projectId: "p_42" });

    expect(dirs.has("/repo/.gnar-term")).toBe(true);
    const written = files.get("/repo/.gnar-term/spacebase.json");
    expect(written).toBe(`${JSON.stringify({ projectId: "p_42" }, null, 2)}\n`);
  });

  it("round-trips through loadRepoConfig", async () => {
    const { deps } = makeFs();
    await writeRepoConfig(deps, "/repo", { projectId: "p_xyz" });
    expect(await loadRepoConfig(deps, "/repo")).toEqual({
      projectId: "p_xyz",
    });
  });
});
