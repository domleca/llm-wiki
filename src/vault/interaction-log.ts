/**
 * Structured interaction log — one JSONL file per day under
 * `.obsidian/plugins/llm-wiki/interactions/`.
 *
 * Each entry captures enough about a single Q&A round-trip to reconstruct
 * model usage, retrieval stats, and latency after the fact without having
 * to replay the original conversation.
 */
import {
  safeAppendPluginData,
  type SafeWriteApp,
} from "./safe-write.js";

export interface InteractionLogEntry {
  question: string;
  answer: string;
  model: string;
  queryType: string;
  entityCount: number;
  conceptCount: number;
  elapsedMs: number;
}

/**
 * Append a single interaction entry to today's log file.
 *
 * `now` is injectable so tests can pin the date without mocking `Date`.
 */
export async function appendInteractionLog(
  app: SafeWriteApp,
  entry: InteractionLogEntry,
  now: () => Date = () => new Date(),
): Promise<void> {
  const ts = now();
  const dateStr = ts.toISOString().slice(0, 10);
  const line = JSON.stringify({ ...entry, timestamp: ts.toISOString() });
  await safeAppendPluginData(app, `interactions/${dateStr}.jsonl`, line);
}
