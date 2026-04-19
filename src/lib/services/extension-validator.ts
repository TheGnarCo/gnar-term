/**
 * Extension Validator — validates extension.json manifests.
 *
 * Extracted from extension-loader.ts for maintainability.
 * Pure validation logic with no side effects.
 */
import { VALID_EVENTS, VALID_PERMISSIONS } from "./extension-constants";

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
  if (contributes?.events !== undefined) {
    if (!Array.isArray(contributes.events)) {
      errors.push("contributes.events must be an array of strings");
    } else {
      for (const event of contributes.events) {
        if (typeof event !== "string") {
          errors.push("contributes.events entries must be strings");
          continue;
        }
        if (!VALID_EVENTS.has(event) && !event.startsWith("extension:")) {
          errors.push(`Invalid event type: ${event}`);
        }
      }
    }
  }

  // Validate permissions — only known names accepted. Unknown strings
  // silently drop later at Set-lookup sites; validating up front gives
  // extension authors a clear error message.
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) {
      errors.push("permissions must be an array of strings");
    } else {
      for (const perm of m.permissions) {
        if (typeof perm !== "string") {
          errors.push("permissions entries must be strings");
          continue;
        }
        if (!VALID_PERMISSIONS.has(perm)) {
          errors.push(
            `Unknown permission: "${perm}". Valid: ${Array.from(
              VALID_PERMISSIONS,
            ).join(", ")}`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
