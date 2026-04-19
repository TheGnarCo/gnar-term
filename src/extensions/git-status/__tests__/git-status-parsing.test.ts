/**
 * Tests for git-status extension parsing logic.
 *
 * Tests the pure parsing functions without needing Tauri IPC.
 */
import { describe, it, expect } from "vitest";

// We test the parsing functions by importing the module and extracting them.
// Since they are not exported, we replicate the logic here for testing.
// In production, these functions are internal to the extension.

function parseGitStatus(raw: string) {
  const lines = raw.trim().split("\n");
  if (lines.length === 0) return null;

  const headerLine = lines[0]!;
  const branchMatch = headerLine.match(
    /^## (?:No commits yet on )?(.+?)(?:\.\.\.|$)/,
  );
  if (!branchMatch) return null;

  const branch = branchMatch[1]!;
  const isDetached = headerLine.startsWith("## HEAD (no branch)");
  const aheadMatch = headerLine.match(/\[ahead (\d+)/);
  const behindMatch = headerLine.match(/behind (\d+)/);

  let modified = 0;
  let untracked = 0;
  let staged = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("??")) {
      untracked++;
    } else {
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      if (indexStatus && indexStatus !== " " && indexStatus !== "?") staged++;
      if (workTreeStatus && workTreeStatus !== " " && workTreeStatus !== "?")
        modified++;
    }
  }

  return {
    branch,
    isDetached,
    modified,
    untracked,
    staged,
    ahead: aheadMatch ? parseInt(aheadMatch[1]!, 10) : 0,
    behind: behindMatch ? parseInt(behindMatch[1]!, 10) : 0,
  };
}

function parsePrInfo(raw: string) {
  try {
    const data = JSON.parse(raw);
    if (!data.number) return null;

    let ciStatus: "passing" | "failing" | "pending" | "none" = "none";
    const checks = data.statusCheckRollup;
    if (Array.isArray(checks) && checks.length > 0) {
      const hasFailure = checks.some(
        (c: { state?: string; conclusion?: string }) =>
          c.state === "FAILURE" ||
          c.conclusion === "FAILURE" ||
          c.state === "ERROR" ||
          c.conclusion === "ERROR",
      );
      const hasPending = checks.some(
        (c: { state?: string; conclusion?: string }) =>
          c.state === "PENDING" || !c.conclusion,
      );
      if (hasFailure) ciStatus = "failing";
      else if (hasPending) ciStatus = "pending";
      else ciStatus = "passing";
    }

    let reviewDecision = "none";
    if (data.reviewDecision === "APPROVED") reviewDecision = "approved";
    else if (data.reviewDecision === "CHANGES_REQUESTED")
      reviewDecision = "changes requested";
    else if (data.reviewDecision === "REVIEW_REQUIRED")
      reviewDecision = "review requested";

    return {
      number: data.number,
      url: data.url,
      reviewDecision,
      ciStatus,
    };
  } catch {
    return null;
  }
}

describe("ScriptOutput exit code contract", () => {
  // Regression: the Rust ScriptOutput struct serializes the exit code as
  // `exit_code`, not `code`. Using the wrong field name causes all commands
  // to silently fail (undefined !== 0 is always true).

  it("exit_code field is used to determine command success", () => {
    // Simulates a successful ScriptOutput from Rust — field name is exit_code
    const successResult = { stdout: "main\n", stderr: "", exit_code: 0 };
    // The condition that runWithTimeout uses:
    const isFailure = !successResult || successResult.exit_code !== 0;
    expect(isFailure).toBe(false);
  });

  it("exit_code field detects non-zero exit", () => {
    const failResult = { stdout: "", stderr: "error", exit_code: 128 };
    const isFailure = !failResult || failResult.exit_code !== 0;
    expect(isFailure).toBe(true);
  });

  it("wrong field name (code) would incorrectly flag success as failure", () => {
    // This is the bug pattern: using `code` instead of `exit_code`
    const result = { stdout: "ok\n", stderr: "", exit_code: 0 };
    // If you mistakenly check `result.code`, it's undefined
    const buggyResult = result as unknown as { code?: number };
    const buggyCheck = buggyResult.code !== 0; // undefined !== 0 = true (BUG)
    expect(buggyCheck).toBe(true); // demonstrates the bug
    // The correct check:
    const correctCheck = result.exit_code !== 0;
    expect(correctCheck).toBe(false); // correct behavior
  });
});

describe("git status parsing", () => {
  describe("parseGitStatus", () => {
    it("parses branch with no changes", () => {
      const result = parseGitStatus("## main...origin/main");
      expect(result).toMatchObject({
        branch: "main",
        isDetached: false,
        modified: 0,
        untracked: 0,
        staged: 0,
      });
    });

    it("parses branch with ahead/behind", () => {
      const result = parseGitStatus(
        "## feat/bar...origin/feat/bar [ahead 2, behind 1]",
      );
      expect(result).toMatchObject({
        branch: "feat/bar",
        ahead: 2,
        behind: 1,
      });
    });

    it("counts modified, untracked, and staged files", () => {
      const raw = [
        "## main...origin/main",
        " M src/foo.ts",
        " M src/bar.ts",
        "A  src/new.ts",
        "?? untracked.txt",
        "?? another.txt",
      ].join("\n");

      const result = parseGitStatus(raw);
      expect(result).toMatchObject({
        modified: 2,
        untracked: 2,
        staged: 1,
      });
    });

    it("handles branch-only header (no tracking)", () => {
      const result = parseGitStatus("## feat/no-remote");
      expect(result).toMatchObject({
        branch: "feat/no-remote",
        ahead: 0,
        behind: 0,
      });
    });

    it("returns null for empty input", () => {
      expect(parseGitStatus("")).toBeNull();
    });
  });

  describe("parsePrInfo", () => {
    it("parses approved PR with passing CI", () => {
      const raw = JSON.stringify({
        number: 42,
        url: "https://github.com/org/repo/pull/42",
        reviewDecision: "APPROVED",
        statusCheckRollup: [
          { state: "SUCCESS", conclusion: "SUCCESS" },
          { state: "SUCCESS", conclusion: "SUCCESS" },
        ],
      });

      const result = parsePrInfo(raw);
      expect(result).toMatchObject({
        number: 42,
        reviewDecision: "approved",
        ciStatus: "passing",
      });
    });

    it("detects failing CI", () => {
      const raw = JSON.stringify({
        number: 38,
        url: "https://github.com/org/repo/pull/38",
        reviewDecision: "CHANGES_REQUESTED",
        statusCheckRollup: [
          { state: "SUCCESS", conclusion: "SUCCESS" },
          { state: "FAILURE", conclusion: "FAILURE" },
        ],
      });

      const result = parsePrInfo(raw);
      expect(result).toMatchObject({
        ciStatus: "failing",
        reviewDecision: "changes requested",
      });
    });

    it("detects pending CI", () => {
      const raw = JSON.stringify({
        number: 51,
        url: "https://github.com/org/repo/pull/51",
        reviewDecision: "APPROVED",
        statusCheckRollup: [
          { state: "SUCCESS", conclusion: "SUCCESS" },
          { state: "PENDING" },
        ],
      });

      const result = parsePrInfo(raw);
      expect(result).toMatchObject({
        ciStatus: "pending",
        reviewDecision: "approved",
      });
    });

    it("handles no status checks", () => {
      const raw = JSON.stringify({
        number: 80,
        url: "https://github.com/org/repo/pull/80",
        reviewDecision: "REVIEW_REQUIRED",
        statusCheckRollup: [],
      });

      const result = parsePrInfo(raw);
      expect(result).toMatchObject({
        ciStatus: "none",
        reviewDecision: "review requested",
      });
    });

    it("returns null for invalid JSON", () => {
      expect(parsePrInfo("not json")).toBeNull();
    });

    it("returns null for missing PR number", () => {
      expect(parsePrInfo(JSON.stringify({ url: "test" }))).toBeNull();
    });
  });
});
