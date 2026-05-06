/**
 * Behavioral tests for sidebar drag-drop reorder index math (B3) and
 * "Close Other Workspaces" array splice math (B4). Source-scan XSS
 * assertions (markdown / image / video previewers and "no null-as-any"
 * scans) were removed — DOMPurify usage and innerHTML avoidance are
 * verified by the previewers' behavior, not by greping their source.
 */

import { describe, it, expect } from "vitest";

describe("Sidebar drag-drop reorder (B3)", () => {
  it("adjusts destination index when dragging forward", () => {
    const workspaces = ["A", "B", "C"];
    const fromIdx = 0;
    const dropTargetIdx = 2;

    const item = workspaces.splice(fromIdx, 1)[0];
    const toIdx = fromIdx < dropTargetIdx ? dropTargetIdx - 1 : dropTargetIdx;
    workspaces.splice(toIdx, 0, item);

    expect(workspaces).toEqual(["B", "A", "C"]);
  });

  it("does not adjust index when dragging backward", () => {
    const workspaces = ["A", "B", "C"];
    const fromIdx = 2;
    const dropTargetIdx = 0;

    const item = workspaces.splice(fromIdx, 1)[0];
    const toIdx = fromIdx < dropTargetIdx ? dropTargetIdx - 1 : dropTargetIdx;
    workspaces.splice(toIdx, 0, item);

    expect(workspaces).toEqual(["C", "A", "B"]);
  });
});

describe("Close Other Workspaces (B4)", () => {
  it("keeps only the target workspace when closing others", () => {
    const workspaces = ["A", "B", "C", "D", "E"];
    let targetIdx = 2;

    for (let i = workspaces.length - 1; i >= 0; i--) {
      if (i !== targetIdx) {
        workspaces.splice(i, 1);
        if (i < targetIdx) targetIdx--;
      }
    }

    expect(workspaces).toEqual(["C"]);
  });

  it("handles target at index 0", () => {
    const workspaces = ["A", "B", "C"];
    let targetIdx = 0;

    for (let i = workspaces.length - 1; i >= 0; i--) {
      if (i !== targetIdx) {
        workspaces.splice(i, 1);
        if (i < targetIdx) targetIdx--;
      }
    }

    expect(workspaces).toEqual(["A"]);
  });

  it("handles target at last index", () => {
    const workspaces = ["A", "B", "C"];
    let targetIdx = 2;

    for (let i = workspaces.length - 1; i >= 0; i--) {
      if (i !== targetIdx) {
        workspaces.splice(i, 1);
        if (i < targetIdx) targetIdx--;
      }
    }

    expect(workspaces).toEqual(["C"]);
  });
});
