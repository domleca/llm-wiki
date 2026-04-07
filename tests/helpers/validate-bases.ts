/**
 * Strict Bases-compatibility validator for frontmatter objects.
 *
 * Used by:
 *   - Phase 1 unit tests (validates this module's own correctness)
 *   - Phase 4 page generation (every generated page is piped through this)
 *
 * Mirrors the spec's "Hard Rules" section verbatim.
 */

const LIST_REQUIRED = new Set(["tags", "aliases", "cssclasses"]);
const DEPRECATED_KEYS: Record<string, string> = {
  tag: "tags",
  alias: "aliases",
  cssclass: "cssclasses",
};
const DATE_KEY_PATTERN = /^date-/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER_KEYS = new Set(["source-count"]);

export function validateBasesFrontmatter(
  fm: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  for (const [key, value] of Object.entries(fm)) {
    // Deprecated keys
    if (DEPRECATED_KEYS[key]) {
      errors.push(
        `Key '${key}' is deprecated — use '${DEPRECATED_KEYS[key]}' (always a list).`,
      );
      continue;
    }

    // Nested objects
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      errors.push(`Field '${key}' is a nested object — flatten it.`);
      continue;
    }

    // List-required fields
    if (LIST_REQUIRED.has(key)) {
      if (!Array.isArray(value)) {
        const got = value === null ? "null" : typeof value;
        errors.push(
          `Field '${key}' must be a list, got ${got}. Use [] for empty.`,
        );
        continue;
      }
    }

    // Integer-required fields
    if (INTEGER_KEYS.has(key)) {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(
          `Field '${key}' must be an integer, got ${typeof value}`,
        );
        continue;
      }
    }

    // Date keys must match ISO 8601 YYYY-MM-DD
    if (DATE_KEY_PATTERN.test(key)) {
      if (typeof value !== "string" || !ISO_DATE.test(value)) {
        errors.push(
          `Field '${key}' must match YYYY-MM-DD, got ${JSON.stringify(value)}`,
        );
        continue;
      }
    }
  }

  return errors;
}
