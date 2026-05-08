import { describe, it, expect } from "vitest";
import { expectedRelPathFor, computeDashboardEntries } from "../dashboard-data";
import type { DocSummary } from "../api-client";

function doc(partial: Partial<DocSummary> & { title: string }): DocSummary {
  return {
    id: partial.id ?? "doc",
    project_id: partial.project_id ?? "proj",
    title: partial.title,
    folder_path: partial.folder_path ?? "/",
    locked: partial.locked ?? false,
    created_by: partial.created_by ?? "u",
    updated_by: partial.updated_by,
    created_at: partial.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("expectedRelPathFor", () => {
  it("uses sanitized title with .md when folder_path is '/'", () => {
    expect(
      expectedRelPathFor(doc({ title: "Onboarding Guide", folder_path: "/" })),
    ).toBe("onboarding-guide.md");
  });

  it("treats empty folder_path the same as '/'", () => {
    expect(expectedRelPathFor(doc({ title: "Hello", folder_path: "" }))).toBe(
      "hello.md",
    );
  });

  it("strips leading and trailing slashes from folder_path", () => {
    expect(
      expectedRelPathFor(doc({ title: "Plan", folder_path: "/clients/" })),
    ).toBe("clients/plan.md");
  });

  it("preserves nested folder segments", () => {
    expect(
      expectedRelPathFor(
        doc({ title: "Plan", folder_path: "/clients/foo-co" }),
      ),
    ).toBe("clients/foo-co/plan.md");
  });

  it("sanitizes the title (lowercasing, whitespace→hyphen, strip)", () => {
    expect(
      expectedRelPathFor(doc({ title: "Q1 Roadmap!", folder_path: "/" })),
    ).toBe("q1-roadmap.md");
  });
});

describe("computeDashboardEntries", () => {
  it("returns local-only for every file when remoteDocs is empty", () => {
    const entries = computeDashboardEntries(["a.md", "subdir/b.md"], []);
    expect(entries).toEqual([
      {
        status: "local-only",
        relPath: "a.md",
        title: "a",
        doc: null,
      },
      {
        status: "local-only",
        relPath: "subdir/b.md",
        title: "b",
        doc: null,
      },
    ]);
  });

  it("marks matched docs as 'synced' (or 'locked' when doc.locked=true)", () => {
    const docs = [
      doc({ id: "1", title: "Plan", folder_path: "/" }),
      doc({ id: "2", title: "Secret", folder_path: "/", locked: true }),
    ];
    const entries = computeDashboardEntries(["plan.md", "secret.md"], docs);
    const planned = entries.find((e) => e.relPath === "plan.md");
    const secret = entries.find((e) => e.relPath === "secret.md");
    expect(planned?.status).toBe("synced");
    expect(planned?.doc?.id).toBe("1");
    expect(secret?.status).toBe("locked");
    expect(secret?.doc?.id).toBe("2");
  });

  it("emits 'remote-only' for docs that have no matching local file", () => {
    const docs = [doc({ id: "1", title: "Missing", folder_path: "/" })];
    const entries = computeDashboardEntries([], docs);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("remote-only");
    expect(entries[0]?.relPath).toBe("missing.md");
    expect(entries[0]?.title).toBe("Missing");
  });

  it("emits 'local-only' for files that have no matching remote doc", () => {
    const docs = [doc({ id: "1", title: "Plan", folder_path: "/" })];
    const entries = computeDashboardEntries(["plan.md", "draft.md"], docs);
    const draft = entries.find((e) => e.relPath === "draft.md");
    expect(draft?.status).toBe("local-only");
    expect(draft?.doc).toBeNull();
  });

  it("uses the doc's title for the display label on synced/remote-only entries", () => {
    const docs = [
      doc({ id: "1", title: "My Big Plan", folder_path: "/clients" }),
    ];
    const entries = computeDashboardEntries(["clients/my-big-plan.md"], docs);
    expect(entries[0]?.title).toBe("My Big Plan");
  });

  it("derives the local-only title from the filename basename minus .md", () => {
    const entries = computeDashboardEntries(["sub/dir/draft-notes.md"], []);
    expect(entries[0]?.title).toBe("draft-notes");
  });

  it("sorts entries lexicographically by relPath", () => {
    const docs = [
      doc({ id: "1", title: "Zeta", folder_path: "/" }),
      doc({ id: "2", title: "Alpha", folder_path: "/" }),
    ];
    const entries = computeDashboardEntries(["middle.md", "alpha.md"], docs);
    expect(entries.map((e) => e.relPath)).toEqual([
      "alpha.md",
      "middle.md",
      "zeta.md",
    ]);
  });
});
