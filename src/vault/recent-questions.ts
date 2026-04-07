/**
 * Ring buffer of the most recently asked questions, persisted to a plain
 * JSON file under `.obsidian/plugins/llm-wiki/recent-questions.json`.
 *
 * The pure `pushRecentQuestion` helper is the heart of the behaviour:
 * it dedupes by promoting an existing entry to the front and trims the
 * list to `max` items. The async load/save pair wires this into the
 * plugin-data layer via `safeWritePluginData`.
 */
import {
  safeReadPluginData,
  safeWritePluginData,
  type SafeWriteApp,
} from "./safe-write.js";

const FILE = "recent-questions.json";

/**
 * Prepend `question` to `list`, removing any previous occurrence so the
 * freshly-used question is always first. The result is trimmed to at most
 * `max` items. Pure — does not mutate `list`.
 */
export function pushRecentQuestion(
  list: readonly string[],
  question: string,
  max: number,
): string[] {
  const without = list.filter((q) => q !== question);
  return [question, ...without].slice(0, Math.max(0, max));
}

/**
 * Load the persisted recent-questions list. Returns `[]` when the file is
 * missing, unreadable, or does not contain a JSON array of strings.
 */
export async function loadRecentQuestions(app: SafeWriteApp): Promise<string[]> {
  const raw = await safeReadPluginData(app, FILE);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Persist the given questions list to the plugin-data file.
 */
export async function saveRecentQuestions(
  app: SafeWriteApp,
  questions: readonly string[],
): Promise<void> {
  await safeWritePluginData(app, FILE, JSON.stringify(questions, null, 2));
}
