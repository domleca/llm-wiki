import { describe, it, expect } from "vitest";
import { ProgressEmitter } from "../../src/runtime/progress.js";

describe("ProgressEmitter", () => {
  it("delivers batch-started and file-completed events in order", () => {
    const e = new ProgressEmitter();
    const events: string[] = [];
    e.on("batch-started", (d) => events.push(`start:${d.total}`));
    e.on("file-completed", (d) => events.push(`done:${d.path}`));

    e.emit("batch-started", { total: 2 });
    e.emit("file-completed", {
      path: "a.md",
      index: 1,
      total: 2,
      entitiesAdded: 1,
      conceptsAdded: 0,
    });
    e.emit("file-completed", {
      path: "b.md",
      index: 2,
      total: 2,
      entitiesAdded: 0,
      conceptsAdded: 1,
    });

    expect(events).toEqual(["start:2", "done:a.md", "done:b.md"]);
  });

  it("off() removes a specific handler", () => {
    const e = new ProgressEmitter();
    const log: number[] = [];
    const handler = (): void => {
      log.push(1);
    };
    e.on("batch-started", handler);
    e.emit("batch-started", { total: 0 });
    e.off("batch-started", handler);
    e.emit("batch-started", { total: 0 });
    expect(log).toEqual([1]);
  });

  it("emits batch-errored with a message", () => {
    const e = new ProgressEmitter();
    let captured = "";
    e.on("batch-errored", (d) => {
      captured = d.message;
    });
    e.emit("batch-errored", { message: "KB stale" });
    expect(captured).toBe("KB stale");
  });
});
