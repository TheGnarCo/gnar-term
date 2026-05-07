/**
 * PreviewSurface type system: predicate behavior + Surface union widening.
 */
import { describe, it, expect } from "vitest";
import {
  isPreviewSurface,
  isTerminalSurface,
  isExtensionSurface,
  type Surface,
  type PreviewSurface,
  type ExtensionSurface,
  type TerminalSurface,
} from "../lib/types";

function mkPreview(): PreviewSurface {
  return {
    kind: "preview",
    id: "m1",
    title: "design.md",
    path: "/abs/path/design.md",
    hasUnread: false,
  };
}

function mkExt(): ExtensionSurface {
  return {
    kind: "extension",
    id: "x1",
    surfaceTypeId: "ext:thing",
    title: "Thing",
    hasUnread: false,
  };
}

function mkTerm(): TerminalSurface {
  return {
    kind: "terminal",
    id: "t1",
    title: "shell",
    ptyId: -1,
    hasUnread: false,
    opened: false,
  } as TerminalSurface;
}

describe("isPreviewSurface predicate", () => {
  it("returns true for a PreviewSurface", () => {
    expect(isPreviewSurface(mkPreview())).toBe(true);
  });

  it("returns false for a TerminalSurface", () => {
    expect(isPreviewSurface(mkTerm())).toBe(false);
  });

  it("returns false for an ExtensionSurface", () => {
    expect(isPreviewSurface(mkExt())).toBe(false);
  });

  it("is mutually exclusive with the other predicates", () => {
    const m = mkPreview();
    expect(isTerminalSurface(m)).toBe(false);
    expect(isExtensionSurface(m)).toBe(false);
  });
});

describe("Surface union", () => {
  it("accepts PreviewSurface as a Surface", () => {
    const surfaces: Surface[] = [mkTerm(), mkExt(), mkPreview()];
    const previews = surfaces.filter(isPreviewSurface);
    expect(previews).toHaveLength(1);
    expect(previews[0].path).toBe("/abs/path/design.md");
  });
});
