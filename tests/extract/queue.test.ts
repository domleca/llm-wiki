import { describe, it, expect, vi } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { runExtraction } from "../../src/extract/queue.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";
import { ProgressEmitter } from "../../src/runtime/progress.js";
import { KBStaleError } from "../../src/vault/kb-store.js";

const EMPTY_JSON =
  '{"source_summary":"","entities":[],"concepts":[],"connections":[]}';

function fakeFile(
  i: number,
  mtime = 1,
): {
  path: string;
  content: string;
  mtime: number;
  origin: "user-note";
} {
  return {
    path: `notes/${i}.md`,
    content: `file ${i} body`,
    mtime,
    origin: "user-note",
  };
}

function makeCannedProvider(n: number): MockLLMProvider {
  return new MockLLMProvider(new Array(n).fill(EMPTY_JSON));
}

describe("runExtraction", () => {
  it("processes all files serially and saves the KB at the end", async () => {
    const kb = new KnowledgeBase();
    const provider = makeCannedProvider(3);
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {
      /* noop */
    });
    const files = [fakeFile(1), fakeFile(2), fakeFile(3)];
    const events: string[] = [];
    emitter.on("batch-started", (d) => events.push(`start:${d.total}`));
    emitter.on("file-completed", (d) => events.push(`done:${d.index}`));
    emitter.on("batch-completed", (d) => events.push(`end:${d.succeeded}`));

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    expect(stats.succeeded).toBe(3);
    expect(stats.failed).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(stats.total).toBe(3);
    expect(provider.calls).toHaveLength(3);
    expect(saveKB).toHaveBeenCalledTimes(1); // end-of-batch only
    expect(events).toEqual(["start:3", "done:1", "done:2", "done:3", "end:3"]);
  });

  it("checkpoints the KB every N files during a long run", async () => {
    const kb = new KnowledgeBase();
    const provider = makeCannedProvider(11);
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {
      /* noop */
    });
    const files = Array.from({ length: 11 }, (_, i) => fakeFile(i + 1));

    await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    // Saves at files 5, 10, and final end-of-batch save => 3 saves total.
    expect(saveKB).toHaveBeenCalledTimes(3);
  });

  it("skips files already processed at the same mtime (idempotent replay)", async () => {
    const kb = new KnowledgeBase();
    kb.markSource({
      path: "notes/1.md",
      mtime: 1,
      origin: "user-note",
    });
    kb.markSource({
      path: "notes/2.md",
      mtime: 1,
      origin: "user-note",
    });
    const provider = makeCannedProvider(3);
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {});
    const files = [
      fakeFile(1),
      fakeFile(2),
      fakeFile(3),
      fakeFile(4),
      fakeFile(5),
    ];
    const skips: string[] = [];
    emitter.on("file-skipped", (d) => skips.push(d.path));

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    expect(stats.skipped).toBe(2);
    expect(stats.succeeded).toBe(3);
    expect(provider.calls).toHaveLength(3);
    expect(skips).toEqual(["notes/1.md", "notes/2.md"]);
  });

  it("stops cleanly at a file boundary when signal is aborted", async () => {
    const kb = new KnowledgeBase();
    const provider = makeCannedProvider(5);
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {});
    const files = Array.from({ length: 5 }, (_, i) => fakeFile(i + 1));
    const controller = new AbortController();

    emitter.on("file-completed", (d) => {
      if (d.index === 2) controller.abort();
    });
    const cancelled = vi.fn();
    emitter.on("batch-cancelled", cancelled);

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
      signal: controller.signal,
    });

    expect(stats.succeeded).toBe(2);
    expect(provider.calls.length).toBe(2);
    expect(saveKB).toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalled();
  });

  it("surfaces KBStaleError via batch-errored and stops processing", async () => {
    const kb = new KnowledgeBase();
    const provider = makeCannedProvider(5);
    const emitter = new ProgressEmitter();
    let call = 0;
    const saveKB = vi.fn(async () => {
      call++;
      if (call === 1) throw new KBStaleError(1, 2);
    });
    const files = Array.from({ length: 6 }, (_, i) => fakeFile(i + 1));
    const errored = vi.fn();
    emitter.on("batch-errored", errored);

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    expect(errored).toHaveBeenCalledTimes(1);
    expect(errored.mock.calls[0]![0].message).toMatch(/KB changed externally/);
    expect(stats.succeeded).toBe(5);
    expect(provider.calls.length).toBe(5);
  });

  it("counts file-level failures without aborting the batch", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([
      EMPTY_JSON,
      "I can't do that.",
      EMPTY_JSON,
    ]);
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {});
    const files = [fakeFile(1), fakeFile(2), fakeFile(3)];
    const failed = vi.fn();
    emitter.on("file-failed", failed);

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    expect(stats.succeeded).toBe(2);
    expect(stats.failed).toBe(1);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
