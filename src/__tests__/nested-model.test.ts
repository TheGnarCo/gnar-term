/**
 * Tests for the nested-workspace grouping model — anchor/member discriminators
 * and the Panel classification helper.
 */
import { describe, it, expect } from "vitest";
import {
  isAnchorWorkspace,
  isWorkspaceMember,
  panelOf,
  type Workspace,
  type Pane,
  type Surface,
} from "../lib/types";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const pane: Pane = { id: "p1", surfaces: [], activeSurfaceId: null };
  return {
    id: "ws1",
    name: "ws",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    ...overrides,
  };
}

describe("anchor / member discriminators", () => {
  it("a lone workspace is an anchor with no members", () => {
    const ws = makeWorkspace();
    expect(isAnchorWorkspace(ws)).toBe(true);
    expect(isWorkspaceMember(ws)).toBe(false);
    expect(ws.memberWorkspaceIds).toBeUndefined();
  });

  it("an anchor with members is still an anchor (no anchorWorkspaceId)", () => {
    const anchor = makeWorkspace({
      id: "anchor",
      memberWorkspaceIds: ["m1", "m2"],
    });
    expect(isAnchorWorkspace(anchor)).toBe(true);
    expect(isWorkspaceMember(anchor)).toBe(false);
  });

  it("a member derives membership from anchorWorkspaceId, not member arrays", () => {
    const member = makeWorkspace({ id: "m1", anchorWorkspaceId: "anchor" });
    expect(isWorkspaceMember(member)).toBe(true);
    expect(isAnchorWorkspace(member)).toBe(false);
  });

  it("membership is independent of any anchor's memberWorkspaceIds list", () => {
    // A member whose anchor never recorded it in memberWorkspaceIds is still
    // a member: the back-reference is canonical.
    const orphanedFromList = makeWorkspace({
      id: "m9",
      anchorWorkspaceId: "anchor",
    });
    const anchorMissingThatId = makeWorkspace({
      id: "anchor",
      memberWorkspaceIds: ["m1"],
    });
    expect(isWorkspaceMember(orphanedFromList)).toBe(true);
    expect(isAnchorWorkspace(anchorMissingThatId)).toBe(true);
  });

  it("the discriminators are exact complements", () => {
    const a = makeWorkspace();
    const m = makeWorkspace({ anchorWorkspaceId: "x" });
    expect(isAnchorWorkspace(a)).toBe(!isWorkspaceMember(a));
    expect(isAnchorWorkspace(m)).toBe(!isWorkspaceMember(m));
  });
});

describe("panelOf", () => {
  it("classifies a terminal surface as a terminal panel", () => {
    const s = { kind: "terminal" } as unknown as Surface;
    expect(panelOf(s)).toBe("terminal");
  });

  it("classifies a preview surface as a browser panel", () => {
    const s = { kind: "preview" } as unknown as Surface;
    expect(panelOf(s)).toBe("browser");
  });
});
