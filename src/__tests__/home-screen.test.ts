/**
 * Tests for HomeScreen and ProjectCard components — source verification
 */
import { describe, it, expect } from "vitest";

describe("HomeScreen component", () => {
  it("imports project stores", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/HomeScreen.svelte",
      "utf-8",
    );
    expect(source).toContain("activeProjects");
  });

  it("has project cards", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/HomeScreen.svelte",
      "utf-8",
    );
    expect(source).toContain("ProjectCard");
    expect(source).toContain("activeProjects");
  });

  it("has add project and clone buttons", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/HomeScreen.svelte",
      "utf-8",
    );
    expect(source).toContain("+ New Project");
    expect(source).toContain("onAddProject");
  });

  it("renders project cards from activeProjects", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/HomeScreen.svelte",
      "utf-8",
    );
    expect(source).toContain("ProjectCard");
    expect(source).toContain("$activeProjects");
  });

  it("renders active project cards", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/HomeScreen.svelte",
      "utf-8",
    );
    expect(source).toContain("$activeProjects");
    expect(source).toContain("ProjectCard");
  });
});

describe("ProjectCard component", () => {
  it("displays project name and path", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/ProjectCard.svelte",
      "utf-8",
    );
    expect(source).toContain("project.name");
    expect(source).toContain("project.path");
  });

  it("has right-click context menu with project management", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/ProjectCard.svelte",
      "utf-8",
    );
    expect(source).toContain("contextmenu");
    expect(source).toContain("Set Inactive");
    expect(source).toContain("Remove Project");
  });

  it("lists open workspaces and has new workspace button", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/lib/components/ProjectCard.svelte",
      "utf-8",
    );
    expect(source).toContain("openWorkspaces");
    expect(source).toContain("+ New Workspace");
    expect(source).toContain("onNewWorkspace");
  });
});
