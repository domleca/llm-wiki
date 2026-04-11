import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { runExtraction } from "../../src/extract/queue.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";
import { ProgressEmitter } from "../../src/runtime/progress.js";
import { createMockApp } from "../helpers/mock-app.js";
import { saveKB, loadKB } from "../../src/vault/kb-store.js";
import { walkVaultFiles } from "../../src/vault/walker.js";
import {
  DEFAULT_MIN_FILE_SIZE,
  DEFAULT_SKIP_DIRS,
  defaultDailiesFromIso,
} from "../../src/extract/defaults.js";

const HAPPY_JSON = `{
  "source_summary": "About Alan Watts.",
  "entities": [{"name":"Alan Watts","type":"person","aliases":[],"facts":["wrote about zen"]}],
  "concepts": [],
  "connections": []
}`;

function longBody(): string {
  return "This is a note about Alan Watts. ".repeat(10);
}

describe("Phase 2 integration", () => {
  it("walks the vault, extracts each file, and saves a shared knowledge.json", async () => {
    const { app, files } = createMockApp();
    const now = Date.now();
    // Seed three markdown files — one skipped by size, two extracted.
    files.set("notes/a.md", {
      path: "notes/a.md",
      content: longBody(),
      mtime: now,
      ctime: now,
    });
    files.set("notes/b.md", {
      path: "notes/b.md",
      content: longBody(),
      mtime: now,
      ctime: now,
    });
    files.set("notes/tiny.md", {
      path: "notes/tiny.md",
      content: "hi",
      mtime: now,
      ctime: now,
    });

    const walked = await walkVaultFiles(app as never, {
      skipDirs: DEFAULT_SKIP_DIRS,
      minFileSize: DEFAULT_MIN_FILE_SIZE,
      dailiesFromIso: defaultDailiesFromIso(),
    });
    expect(walked.map((w) => w.path).sort()).toEqual([
      "notes/a.md",
      "notes/b.md",
    ]);

    const queueFiles = walked.map((w) => ({
      path: w.path,
      content: files.get(w.path)!.content,
      mtime: w.mtime,
      contentHash: `hash:${w.path}`,
      origin: w.origin,
    }));

    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([HAPPY_JSON, HAPPY_JSON]);
    const emitter = new ProgressEmitter();
    let kbMtime = 0;

    const stats = await runExtraction({
      provider,
      kb,
      files: queueFiles,
      model: "qwen2.5:7b",
      saveKB: async () => {
        await saveKB(app as never, kb, kbMtime);
        const r = await loadKB(app as never);
        kbMtime = r.mtime;
      },
      emitter,
      checkpointEvery: 5,
    });

    expect(stats.succeeded).toBe(2);
    expect(stats.failed).toBe(0);
    expect(stats.skipped).toBe(0);

    // knowledge.json was written to the mock vault.
    const stored = files.get("wiki/knowledge.json");
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!.content);
    expect(parsed.entities["alan-watts"]?.name).toBe("Alan Watts");
    expect(parsed.sources["notes/a.md"]).toBeDefined();
    expect(parsed.sources["notes/b.md"]).toBeDefined();
  });

  it("is idempotent on re-run (no LLM calls for unchanged files)", async () => {
    const { app, files } = createMockApp();
    const now = Date.now();
    files.set("notes/a.md", {
      path: "notes/a.md",
      content: longBody(),
      mtime: now,
      ctime: now,
    });

    const kb = new KnowledgeBase();
    let kbMtime = 0;
    const emitter = new ProgressEmitter();

    const walked = await walkVaultFiles(app as never, {
      skipDirs: DEFAULT_SKIP_DIRS,
      minFileSize: DEFAULT_MIN_FILE_SIZE,
      dailiesFromIso: defaultDailiesFromIso(),
    });
    const queueFiles = walked.map((w) => ({
      path: w.path,
      content: files.get(w.path)!.content,
      mtime: w.mtime,
      contentHash: `hash:${w.path}`,
      origin: w.origin,
    }));

    // First run — one LLM call.
    const provider = new MockLLMProvider([HAPPY_JSON]);
    await runExtraction({
      provider,
      kb,
      files: queueFiles,
      model: "qwen2.5:7b",
      saveKB: async () => {
        await saveKB(app as never, kb, kbMtime);
        kbMtime = (await loadKB(app as never)).mtime;
      },
      emitter,
    });
    expect(provider.calls).toHaveLength(1);

    // Second run with the same file contents — zero LLM calls.
    const reloaded = await loadKB(app as never);
    const stats = await runExtraction({
      provider,
      kb: reloaded.kb,
      files: queueFiles,
      model: "qwen2.5:7b",
      saveKB: async () => {
        await saveKB(app as never, reloaded.kb, reloaded.mtime);
      },
      emitter,
    });
    expect(provider.calls).toHaveLength(1); // unchanged
    expect(stats.skipped).toBe(1);
    expect(stats.succeeded).toBe(0);
  });

  it("surfaces batch-errored on external KB modification during checkpoint", async () => {
    const { app, files } = createMockApp();
    const now = Date.now();
    for (let i = 1; i <= 6; i++) {
      files.set(`notes/${i}.md`, {
        path: `notes/${i}.md`,
        content: longBody(),
        mtime: now,
        ctime: now,
      });
    }
    const kb = new KnowledgeBase();
    let kbMtime = 0;
    const emitter = new ProgressEmitter();
    const walked = await walkVaultFiles(app as never, {
      skipDirs: DEFAULT_SKIP_DIRS,
      minFileSize: DEFAULT_MIN_FILE_SIZE,
      dailiesFromIso: defaultDailiesFromIso(),
    });
    const queueFiles = walked.map((w) => ({
      path: w.path,
      content: files.get(w.path)!.content,
      mtime: w.mtime,
      contentHash: `hash:${w.path}`,
      origin: w.origin,
    }));
    const provider = new MockLLMProvider(
      new Array(6).fill(
        '{"source_summary":"","entities":[],"concepts":[],"connections":[]}',
      ),
    );

    const errorMsgs: string[] = [];
    emitter.on("batch-errored", (d) => errorMsgs.push(d.message));

    // Simulate an external write right before the checkpoint at file 5.
    const saveKbWrapper = async (): Promise<void> => {
      await saveKB(app as never, kb, kbMtime);
      const r = await loadKB(app as never);
      kbMtime = r.mtime;
    };
    // Inject: after the 3rd file, bump the mtime of wiki/knowledge.json on the
    // mock. The first save occurred at the checkpoint after file 2, so the
    // file now exists and the bump will be observed at the next checkpoint.
    let processedCount = 0;
    emitter.on("file-completed", () => {
      processedCount++;
      if (processedCount === 3) {
        const kbFile = files.get("wiki/knowledge.json");
        if (kbFile) kbFile.mtime = now + 999_999;
      }
    });

    await runExtraction({
      provider,
      kb,
      files: queueFiles,
      model: "qwen2.5:7b",
      saveKB: saveKbWrapper,
      emitter,
      checkpointEvery: 2,
    });

    expect(errorMsgs.length).toBeGreaterThanOrEqual(1);
    expect(errorMsgs[0]).toMatch(/KB changed externally/);
  });
});
