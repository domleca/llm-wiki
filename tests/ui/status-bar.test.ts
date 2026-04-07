import { describe, it, expect } from "vitest";
import { StatusBarWidget } from "../../src/ui/status-bar.js";
import { ProgressEmitter } from "../../src/runtime/progress.js";

function fakeEl(): { setText: (t: string) => void; texts: string[] } {
  const texts: string[] = [];
  return {
    setText: (t: string) => texts.push(t),
    texts,
  };
}

describe("StatusBarWidget", () => {
  it("starts in the idle state", () => {
    const el = fakeEl();
    const emitter = new ProgressEmitter();
    new StatusBarWidget(el, emitter);
    expect(el.texts.at(-1)).toBe("🧠 LLM Wiki");
  });

  it("updates to indexing label on batch-started + file-completed events", () => {
    const el = fakeEl();
    const emitter = new ProgressEmitter();
    new StatusBarWidget(el, emitter);
    emitter.emit("batch-started", { total: 10 });
    expect(el.texts.at(-1)).toMatch(/Indexing 0\/10/);
    emitter.emit("file-completed", {
      path: "a.md",
      index: 1,
      total: 10,
      entitiesAdded: 0,
      conceptsAdded: 0,
    });
    expect(el.texts.at(-1)).toMatch(/Indexing 1\/10/);
  });

  it("returns to idle after batch-completed", () => {
    const el = fakeEl();
    const emitter = new ProgressEmitter();
    new StatusBarWidget(el, emitter);
    emitter.emit("batch-started", { total: 1 });
    emitter.emit("file-completed", {
      path: "a.md",
      index: 1,
      total: 1,
      entitiesAdded: 0,
      conceptsAdded: 0,
    });
    emitter.emit("batch-completed", {
      processed: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      total: 1,
      elapsedMs: 100,
    });
    expect(el.texts.at(-1)).toBe("🧠 LLM Wiki");
  });

  it("shows the error state on batch-errored", () => {
    const el = fakeEl();
    const emitter = new ProgressEmitter();
    new StatusBarWidget(el, emitter);
    emitter.emit("batch-errored", { message: "KB changed externally" });
    expect(el.texts.at(-1)).toBe("🧠 ⚠ KB changed externally");
  });
});
