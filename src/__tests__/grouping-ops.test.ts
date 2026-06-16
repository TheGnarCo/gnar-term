/**
 * Tests for the grouping operations in workspace-service.
 *
 * Membership is always derived from the member's `anchorWorkspaceId` tag;
 * `memberWorkspaceIds` records order only. These tests verify create-group,
 * add/remove member, reorder, reclaim, and the promote-first-member back-edge.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { workspaces } from "../lib/stores/workspace";
import {
  setWorkspaceOrder,
  workspaceOrder,
  cancelOrderPersist,
} from "../lib/stores/workspace-order";
import { cancelPersist } from "../lib/services/workspace-persist";
import {
  addMemberToGroup,
  createGroupWithAnchor,
  removeMemberFromAllGroups,
  reorderMembers,
  getMembersOfGroup,
  promoteMemberToAnchor,
  reclaimGroupMembers,
  materializeStandaloneAnchors,
} from "../lib/services/workspace-service";
import type { Workspace, Pane } from "../lib/types";

function ws(id: string, extra: Partial<Workspace> = {}): Workspace {
  const pane: Pane = { id: `${id}-p`, surfaces: [], activeSurfaceId: null };
  return {
    id,
    name: id,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    ...extra,
  };
}

const orderIds = () => get(workspaceOrder).map((r) => r.id);

beforeEach(() => {
  cancelPersist();
  cancelOrderPersist();
  workspaces.set([]);
  setWorkspaceOrder([]);
  cancelOrderPersist();
});

describe("addMemberToGroup", () => {
  it("tags the member, appends to the anchor's order, and drops its row", () => {
    workspaces.set([ws("anchor"), ws("m1")]);
    setWorkspaceOrder([
      { kind: "workspace", id: "anchor" },
      { kind: "workspace", id: "m1" },
    ]);

    expect(addMemberToGroup("anchor", "m1")).toBe(true);

    const list = get(workspaces);
    expect(list.find((w) => w.id === "m1")?.anchorWorkspaceId).toBe("anchor");
    expect(list.find((w) => w.id === "anchor")?.memberWorkspaceIds).toEqual([
      "m1",
    ]);
    // The member nests under the anchor and no longer owns a top-level row.
    expect(orderIds()).toEqual(["anchor"]);
  });

  it("is idempotent and no-ops when a workspace is missing", () => {
    workspaces.set([ws("anchor"), ws("m1")]);
    addMemberToGroup("anchor", "m1");
    expect(addMemberToGroup("anchor", "m1")).toBe(false);
    expect(addMemberToGroup("anchor", "ghost")).toBe(false);
    expect(addMemberToGroup("ghost", "m1")).toBe(false);
    expect(addMemberToGroup("anchor", "anchor")).toBe(false);
  });
});

describe("getMembersOfGroup", () => {
  it("derives membership from the tag, not the ordering array", () => {
    workspaces.set([
      ws("anchor", { memberWorkspaceIds: ["stale"] }),
      ws("m1", { anchorWorkspaceId: "anchor" }),
      ws("m2", { anchorWorkspaceId: "anchor" }),
      ws("other"),
    ]);
    const members = getMembersOfGroup("anchor").map((w) => w.id);
    expect(members.sort()).toEqual(["m1", "m2"]);
  });
});

describe("createGroupWithAnchor", () => {
  it("starts a group around an existing workspace", () => {
    workspaces.set([ws("anchor"), ws("m1")]);
    expect(createGroupWithAnchor("anchor", "m1")).toBe(true);
    expect(get(workspaces).find((w) => w.id === "m1")?.anchorWorkspaceId).toBe(
      "anchor",
    );
  });
});

describe("removeMemberFromAllGroups", () => {
  it("strips the id from every anchor's ordering array", () => {
    workspaces.set([
      ws("a1", { memberWorkspaceIds: ["m1", "m2"] }),
      ws("a2", { memberWorkspaceIds: ["m1"] }),
      ws("m1", { anchorWorkspaceId: "a1" }),
      ws("m2", { anchorWorkspaceId: "a1" }),
    ]);
    removeMemberFromAllGroups("m1");
    const list = get(workspaces);
    expect(list.find((w) => w.id === "a1")?.memberWorkspaceIds).toEqual(["m2"]);
    expect(list.find((w) => w.id === "a2")?.memberWorkspaceIds).toEqual([]);
  });
});

describe("reorderMembers", () => {
  it("moves a member within the anchor's ordered list", () => {
    workspaces.set([
      ws("anchor", { memberWorkspaceIds: ["m1", "m2", "m3"] }),
      ws("m1", { anchorWorkspaceId: "anchor" }),
      ws("m2", { anchorWorkspaceId: "anchor" }),
      ws("m3", { anchorWorkspaceId: "anchor" }),
    ]);
    reorderMembers("anchor", 0, 3); // m1 to the end
    expect(
      get(workspaces).find((w) => w.id === "anchor")?.memberWorkspaceIds,
    ).toEqual(["m2", "m3", "m1"]);
  });

  it("no-ops on out-of-range indices or missing anchor", () => {
    workspaces.set([ws("anchor", { memberWorkspaceIds: ["m1"] })]);
    reorderMembers("anchor", 5, 0);
    reorderMembers("ghost", 0, 1);
    expect(
      get(workspaces).find((w) => w.id === "anchor")?.memberWorkspaceIds,
    ).toEqual(["m1"]);
  });
});

describe("reclaimGroupMembers", () => {
  it("rebuilds member arrays from anchorWorkspaceId tags", () => {
    workspaces.set([
      ws("anchor"), // no memberWorkspaceIds at all
      ws("m1", { anchorWorkspaceId: "anchor" }),
      ws("m2", { anchorWorkspaceId: "anchor" }),
    ]);
    reclaimGroupMembers();
    expect(
      get(workspaces).find((w) => w.id === "anchor")?.memberWorkspaceIds,
    ).toEqual(["m1", "m2"]);
  });

  it("clears a stale ordering array whose members were retagged away", () => {
    workspaces.set([
      ws("anchor", { memberWorkspaceIds: ["m1"] }),
      ws("m1"), // tag removed — no longer a member
    ]);
    reclaimGroupMembers();
    expect(
      get(workspaces).find((w) => w.id === "anchor")?.memberWorkspaceIds,
    ).toEqual([]);
  });
});

describe("materializeStandaloneAnchors", () => {
  it("adds a row for every anchor, never for members", () => {
    workspaces.set([
      ws("a1"),
      ws("a2"),
      ws("m1", { anchorWorkspaceId: "a1" }),
    ]);
    setWorkspaceOrder([]);
    cancelOrderPersist();
    materializeStandaloneAnchors();
    expect(orderIds().sort()).toEqual(["a1", "a2"]);
  });
});

describe("promoteMemberToAnchor (last-pane-close back-edge)", () => {
  it("promotes the first member, retags the rest, keeps the row position", () => {
    workspaces.set([
      ws("before"),
      ws("anchor", { memberWorkspaceIds: ["m1", "m2"] }),
      ws("after"),
      ws("m1", { anchorWorkspaceId: "anchor" }),
      ws("m2", { anchorWorkspaceId: "anchor" }),
    ]);
    setWorkspaceOrder([
      { kind: "workspace", id: "before" },
      { kind: "workspace", id: "anchor" },
      { kind: "workspace", id: "after" },
    ]);
    cancelOrderPersist();

    const promoted = promoteMemberToAnchor("anchor");
    expect(promoted).toBe("m1");

    const list = get(workspaces);
    const m1 = list.find((w) => w.id === "m1")!;
    const m2 = list.find((w) => w.id === "m2")!;
    expect(m1.anchorWorkspaceId).toBeUndefined();
    expect(m1.memberWorkspaceIds).toEqual(["m2"]);
    expect(m2.anchorWorkspaceId).toBe("m1");
    // The new anchor inherits the closed anchor's slot.
    expect(orderIds()).toEqual(["before", "m1", "after"]);
  });

  it("returns null when the anchor has no members (group vanishes)", () => {
    workspaces.set([ws("anchor")]);
    setWorkspaceOrder([{ kind: "workspace", id: "anchor" }]);
    cancelOrderPersist();
    expect(promoteMemberToAnchor("anchor")).toBeNull();
    // No row swap happened — the caller drops the row on close.
    expect(orderIds()).toEqual(["anchor"]);
  });
});
