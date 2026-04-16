/**
 * Extension Validator — validates extension.json manifests.
 *
 * Extracted from extension-loader.ts for maintainability.
 * Pure validation logic with no side effects.
 */
import { VALID_EVENTS } from "./extension-constants";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate extension id: lowercase alphanumeric with single hyphens,
 * must start and end with alphanumeric. Uses a linear scan instead of
 * regex to avoid backtracking complexity.
 */
export function isValidExtensionId(id: string): boolean {
  if (id.length === 0) return false;
  for (let i = 0; i < id.length; i++) {
    const c = id[i]!;
    const isAlnum = (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
    const isHyphen = c === "-";
    if (!isAlnum && !isHyphen) return false;
    // First and last char must be alphanumeric; no consecutive hyphens
    if (isHyphen && (i === 0 || i === id.length - 1 || id[i - 1]! === "-"))
      return false;
  }
  return true;
}

export function validateManifest(manifest: unknown): ValidationResult {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["Manifest must be an object"] };
  }

  const m = manifest as Record<string, unknown>;
  if (!m.id || typeof m.id !== "string") {
    errors.push("Missing or invalid required field: id");
  } else if (!isValidExtensionId(m.id as string)) {
    errors.push(
      'Invalid id format: must be lowercase alphanumeric with hyphens (e.g. "my-extension")',
    );
  }
  if (!m.name || typeof m.name !== "string") {
    errors.push("Missing or invalid required field: name");
  }
  if (!m.version || typeof m.version !== "string") {
    errors.push("Missing or invalid required field: version");
  }
  if (!m.entry || typeof m.entry !== "string") {
    errors.push("Missing or invalid required field: entry");
  } else {
    const entry = m.entry as string;
    if (
      entry.includes("..") ||
      entry.startsWith("/") ||
      entry.startsWith("\\")
    ) {
      errors.push(
        "Invalid entry path: must not contain '..' or start with '/' or '\\\\'",
      );
    }
  }

  // Validate declared events
  const contributes = m.contributes as Record<string, unknown> | undefined;
  if (contributes?.events) {
    for (const event of contributes.events as string[]) {
      if (!VALID_EVENTS.has(event) && !event.startsWith("extension:")) {
        errors.push(`Invalid event type: ${event}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
