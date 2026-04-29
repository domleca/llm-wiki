/**
 * Hard-coded defaults for Phase 2. Phase 5 will surface these in the
 * settings UI; isolating them here now means that refactor is a pure
 * move-to-settings operation.
 */

export const DEFAULT_CHAR_LIMIT = 12_000;

/** Minimum file size (in characters) before a file is considered
 *  worth extracting. Below this, the file is skipped. */
export const DEFAULT_MIN_FILE_SIZE = 100;

/**
 * Directory names to skip when walking the vault for extraction.
 * Takes the user's configDir at call time so we never assume
 * `.obsidian` (Obsidian lets users move it).
 */
export function defaultSkipDirs(configDir: string): string[] {
  return [
    "wiki",
    configDir,
    ".trash",
    "Template",
    "Templates",
    "Assets",
  ];
}

/** Default cutoff for dailies: one year ago (ISO date). Dailies older than
 *  this are skipped from extraction. Computed lazily so tests can mock Date. */
export function defaultDailiesFromIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
