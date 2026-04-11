import type { KnowledgeBase } from "../core/kb.js";
import type { LLMProvider } from "../llm/provider.js";
import { LLMAbortError } from "../llm/provider.js";
import type { ProgressEmitter } from "../runtime/progress.js";
import { KBStaleError } from "../vault/kb-store.js";
import { extractFile, type ExtractFileInput } from "./extractor.js";

export type QueueFile = ExtractFileInput;

export interface RunExtractionArgs {
  provider: LLMProvider;
  kb: KnowledgeBase;
  files: QueueFile[];
  model: string;
  /** Persists the KB to disk. Implementation supplies this — typically a
   *  closure around `saveKB(app, kb, mtime)` that updates its captured
   *  mtime on success. */
  saveKB: () => Promise<void>;
  emitter: ProgressEmitter;
  /** Checkpoint every N successful files. Defaults to 5. */
  checkpointEvery?: number;
  /** Truncate file content at this many characters before prompting. */
  charLimit?: number;
  /** Language to request for extracted summaries/facts/definitions. */
  outputLanguage?: string;
  /** Cancellation signal. If it fires, the queue exits cleanly at the next
   *  file boundary. */
  signal?: AbortSignal;
}

export interface RunExtractionStats {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  elapsedMs: number;
}

export async function runExtraction(
  args: RunExtractionArgs,
): Promise<RunExtractionStats> {
  const { provider, kb, files, model, saveKB, emitter, charLimit } = args;
  const checkpointEvery = args.checkpointEvery ?? 5;
  const total = files.length;
  const t0 = Date.now();
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let processedSinceCheckpoint = 0;

  emitter.emit("batch-started", { total });

  const isAborted = (): boolean => args.signal?.aborted === true;

  outer: for (let i = 0; i < total; i++) {
    if (isAborted()) break;

    const file = files[i]!;
    const index = i + 1;

    if (!kb.needsExtraction(file.path, file.mtime)) {
      skipped++;
      emitter.emit("file-skipped", { path: file.path, index, total });
      continue;
    }

    emitter.emit("file-started", { path: file.path, index, total });

    const preEntities = kb.stats().entities;
    const preConcepts = kb.stats().concepts;

    try {
      const result = await extractFile({
        provider,
        kb,
        file,
        model,
        outputLanguage: args.outputLanguage,
        signal: args.signal,
        charLimit,
      });
      if (result) {
        const stats = kb.stats();
        succeeded++;
        processedSinceCheckpoint++;
        emitter.emit("file-completed", {
          path: file.path,
          index,
          total,
          entitiesAdded: stats.entities - preEntities,
          conceptsAdded: stats.concepts - preConcepts,
        });
      } else {
        failed++;
        emitter.emit("file-failed", {
          path: file.path,
          index,
          total,
          reason: "LLM response could not be parsed",
        });
      }
    } catch (e) {
      if (e instanceof LLMAbortError || isAborted()) {
        break outer;
      }
      failed++;
      const reason = (e as Error).message ?? "Unknown error";
      emitter.emit("file-failed", { path: file.path, index, total, reason });
    }

    // Periodic checkpoint save — every N successful files.
    if (processedSinceCheckpoint >= checkpointEvery) {
      try {
        await saveKB();
        emitter.emit("checkpoint", { processed: index, total });
        processedSinceCheckpoint = 0;
      } catch (e) {
        const message =
          e instanceof KBStaleError
            ? `KB changed externally during extraction (expected mtime ${e.expectedMtime}, actual ${e.actualMtime}). Re-run the command to continue.`
            : (e as Error).message;
        emitter.emit("batch-errored", { message });
        return {
          total,
          succeeded,
          failed,
          skipped,
          elapsedMs: Date.now() - t0,
        };
      }
    }
  }

  // Final save (end of batch OR cancellation).
  try {
    await saveKB();
  } catch (e) {
    const message =
      e instanceof KBStaleError
        ? `KB changed externally during extraction (expected mtime ${e.expectedMtime}, actual ${e.actualMtime}). Re-run the command to continue.`
        : (e as Error).message;
    emitter.emit("batch-errored", { message });
    return {
      total,
      succeeded,
      failed,
      skipped,
      elapsedMs: Date.now() - t0,
    };
  }

  const elapsedMs = Date.now() - t0;

  if (isAborted()) {
    emitter.emit("batch-cancelled", {
      processed: succeeded + failed,
      total,
    });
  } else {
    emitter.emit("batch-completed", {
      processed: succeeded + failed + skipped,
      succeeded,
      failed,
      skipped,
      total,
      elapsedMs,
    });
  }

  return { total, succeeded, failed, skipped, elapsedMs };
}
