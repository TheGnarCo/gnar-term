/**
 * Verifies that the Archive zone is rendered only when the sidebar is
 * expanded. While collapsed, the archive banner must not appear.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import Sidebar from "../lib/components/Sidebar.svelte";
import { sidebarVisible } from "../lib/stores/ui";

describe("Sidebar Archive visibility", () => {
  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
  });

  it("renders the archive zone when expanded", () => {
    sidebarVisible.set(true);
    const { container } = render(Sidebar);
    expect(container.querySelector("[data-archive-zone]")).not.toBeNull();
  });

  it("hides the archive zone when collapsed", () => {
    sidebarVisible.set(false);
    const { container } = render(Sidebar);
    expect(container.querySelector("[data-archive-zone]")).toBeNull();
  });
});
