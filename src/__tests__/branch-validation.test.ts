/**
 * Tests for branch name validation utilities.
 *
 * Validates git branch naming rules and duplicate detection.
 */
import { describe, it, expect } from "vitest";
import {
  validateBranchName,
  checkBranchDuplicate,
} from "../lib/branch-validation";

describe("validateBranchName", () => {
  it("accepts valid branch names", () => {
    expect(validateBranchName("feature/my-branch")).toEqual({ valid: true });
    expect(validateBranchName("jrvs/feat-x")).toEqual({ valid: true });
    expect(validateBranchName("main")).toEqual({ valid: true });
    expect(validateBranchName("fix/issue-123")).toEqual({ valid: true });
    expect(validateBranchName("release/v1.0.0")).toEqual({ valid: true });
  });

  it("rejects empty or whitespace-only names", () => {
    expect(validateBranchName("")).toEqual({
      valid: false,
      error: "Branch name is required",
    });
    // Whitespace-only is caught by the spaces check before trim
    expect(validateBranchName("   ").valid).toBe(false);
  });

  it("rejects names with spaces", () => {
    const result = validateBranchName("my branch");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("spaces");
  });

  it("rejects names with '..' sequences", () => {
    const result = validateBranchName("feature..test");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("..");
  });

  it("rejects names with ASCII control characters", () => {
    const result = validateBranchName("feature\x01test");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("control characters");
  });

  it("rejects names with tilde", () => {
    const result = validateBranchName("feature~1");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("~");
  });

  it("rejects names with caret", () => {
    const result = validateBranchName("feature^2");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("^");
  });

  it("rejects names with colon", () => {
    const result = validateBranchName("feature:test");
    expect(result.valid).toBe(false);
    expect(result.error).toContain(":");
  });

  it("rejects names with backslash", () => {
    const result = validateBranchName("feature\\test");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("\\");
  });

  it("rejects names with square bracket", () => {
    const result = validateBranchName("feature[test");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("[");
  });

  it("rejects names with question mark", () => {
    const result = validateBranchName("feature?test");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("?");
  });

  it("rejects names with asterisk", () => {
    const result = validateBranchName("feature*test");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("*");
  });

  it("rejects names starting with '.'", () => {
    const result = validateBranchName(".hidden-branch");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("start or end with '.'");
  });

  it("rejects names ending with '.'", () => {
    const result = validateBranchName("branch.");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("start or end with '.'");
  });

  it("rejects names ending with '.lock'", () => {
    const result = validateBranchName("branch.lock");
    expect(result.valid).toBe(false);
    expect(result.error).toContain(".lock");
  });

  it("rejects names containing '@{'", () => {
    const result = validateBranchName("feature@{0}");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("@{");
  });
});

describe("checkBranchDuplicate", () => {
  const branches = [
    { name: "main", isRemote: false },
    { name: "feature/existing", isRemote: false },
    { name: "origin/main", isRemote: true },
    { name: "origin/feature/existing", isRemote: true },
  ];

  it("returns valid for a unique branch name", () => {
    expect(checkBranchDuplicate("feature/new-one", branches)).toEqual({
      valid: true,
    });
  });

  it("returns invalid when branch name matches a local branch", () => {
    const result = checkBranchDuplicate("feature/existing", branches);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Branch already exists");
  });

  it("returns invalid when branch matches main", () => {
    const result = checkBranchDuplicate("main", branches);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Branch already exists");
  });

  it("does not flag remote-only branches as duplicates", () => {
    const result = checkBranchDuplicate("origin/main", branches);
    expect(result.valid).toBe(true);
  });

  it("returns valid for empty branch list", () => {
    expect(checkBranchDuplicate("anything", [])).toEqual({ valid: true });
  });
});
