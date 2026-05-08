/**
 * Lowercase, replace each whitespace character with `-`, and strip any
 * character outside `[a-z0-9._-]`.
 *
 * Mirrors the bash `sanitize()` in
 * `~/.claude/plugins/marketplaces/gnar/spacebase/skills/spacebase-api/scripts/spacebase-helpers.sh`
 * exactly so file names produced here line up with files written by the
 * gnar plugin's `spacebase-sync.sh`.
 */
export function sanitize(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/\s/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}
