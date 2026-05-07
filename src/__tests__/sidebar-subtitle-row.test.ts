/**
 * SidebarSubtitleRow — thin wrapper that carries the shared 11px flex
 * styles used by status / subtitle rows under workspace items and
 * workspace banners. The tests pin the styling contract that callers
 * depend on (font-size, padding default, opacity opt-in) and the
 * attribute forwarding via $$restProps. Inline-style assertions read
 * `element.style.*` so JSDOM's normalization (`0` → `0px`, hex → rgb)
 * doesn't make them brittle.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import SidebarSubtitleRow from "../lib/components/SidebarSubtitleRow.svelte";

afterEach(() => {
  cleanup();
});

function getRow(container: HTMLElement): HTMLDivElement {
  const el = container.querySelector("div");
  if (!el) throw new Error("SidebarSubtitleRow root not found");
  return el as HTMLDivElement;
}

describe("SidebarSubtitleRow", () => {
  it("applies the shared 11px flex styles plus the caller's color", () => {
    const { container } = render(SidebarSubtitleRow, {
      props: { color: "rgb(171, 205, 239)" },
    });
    const row = getRow(container);
    expect(row.style.fontSize).toBe("11px");
    expect(row.style.display).toBe("flex");
    expect(row.style.alignItems).toBe("center");
    expect(row.style.gap).toBe("4px");
    expect(row.style.overflow).toBe("hidden");
    expect(row.style.color).toBe("rgb(171, 205, 239)");
  });

  it("uses the default padding when none is provided", () => {
    const { container } = render(SidebarSubtitleRow, {
      props: { color: "rgb(255, 255, 255)" },
    });
    const row = getRow(container);
    expect(row.style.padding).toBe("0px 24px 2px 2px");
  });

  it("honors a custom padding prop", () => {
    const { container } = render(SidebarSubtitleRow, {
      props: { color: "rgb(255, 255, 255)", padding: "0 12px 4px 6px" },
    });
    const row = getRow(container);
    expect(row.style.padding).toBe("0px 12px 4px 6px");
  });

  it("omits opacity by default and applies it when set", () => {
    const noOpacity = render(SidebarSubtitleRow, {
      props: { color: "rgb(255, 255, 255)" },
    });
    expect(getRow(noOpacity.container).style.opacity).toBe("");
    cleanup();

    const withOpacity = render(SidebarSubtitleRow, {
      props: { color: "rgb(255, 255, 255)", opacity: 0.85 },
    });
    expect(getRow(withOpacity.container).style.opacity).toBe("0.85");
  });

  it("forwards arbitrary attributes (data-*, aria-*, title) via restProps", () => {
    const { container } = render(SidebarSubtitleRow, {
      props: {
        color: "rgb(255, 255, 255)",
        // @ts-expect-error — restProps are not in the typed prop list
        "data-test-row": "yes",
        "aria-hidden": "true",
        title: "tooltip text",
      },
    });
    const row = getRow(container);
    expect(row.getAttribute("data-test-row")).toBe("yes");
    expect(row.getAttribute("aria-hidden")).toBe("true");
    expect(row.getAttribute("title")).toBe("tooltip text");
  });
});
