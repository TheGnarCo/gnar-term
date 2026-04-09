/**
 * Branch name validation — pure utility functions for git branch name checks.
 *
 * Validates branch names against git naming rules and checks for duplicates
 * against an existing branch list.
 */

export interface BranchValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a branch name against git naming rules.
 *
 * Rules enforced (from git-check-ref-format):
 * - No spaces
 * - No ".." sequences
 * - No ASCII control characters (0x00-0x1F, 0x7F)
 * - No "~", "^", ":", "\\", "[", "?", "*" characters
 * - Cannot start or end with "."
 * - Cannot end with ".lock"
 * - Cannot contain "@{"
 * - Cannot be empty
 */
export function validateBranchName(name: string): BranchValidationResult {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Branch name is required" };
  }

  if (name.includes(" ")) {
    return {
      valid: false,
      error: "Invalid branch name: spaces are not allowed",
    };
  }

  if (name.includes("..")) {
    return { valid: false, error: "Invalid branch name: '..' is not allowed" };
  }

  // ASCII control characters (0x00-0x1F and 0x7F)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(name)) {
    return {
      valid: false,
      error: "Invalid branch name: control characters are not allowed",
    };
  }

  if (/[~^:\\\[\?\*]/.test(name)) {
    const match = name.match(/[~^:\\\[\?\*]/);
    return {
      valid: false,
      error: `Invalid branch name: '${match![0]}' is not allowed`,
    };
  }

  if (name.startsWith(".") || name.endsWith(".")) {
    return {
      valid: false,
      error: "Invalid branch name: cannot start or end with '.'",
    };
  }

  if (name.endsWith(".lock")) {
    return {
      valid: false,
      error: "Invalid branch name: cannot end with '.lock'",
    };
  }

  if (name.includes("@{")) {
    return { valid: false, error: "Invalid branch name: '@{' is not allowed" };
  }

  return { valid: true };
}

/**
 * Check if a branch name already exists in a list of branches.
 * Compares against both the raw name and names with remote prefixes stripped.
 */
export function checkBranchDuplicate(
  name: string,
  existingBranches: Array<{ name: string; isRemote: boolean }>,
): BranchValidationResult {
  const localNames = existingBranches
    .filter((b) => !b.isRemote)
    .map((b) => b.name);

  if (localNames.includes(name)) {
    return { valid: false, error: "Branch already exists" };
  }

  return { valid: true };
}
