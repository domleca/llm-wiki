import { describe, expect, it } from "vitest";

import { OnSaveWatcher } from "../../src/runtime/on-save-watcher.js";
import type { OnSaveWatcherOptions } from "../../src/runtime/on-save-watcher.js";

function createWatcher(overrides: Partial<OnSaveWatcherOptions> = {}) {
  const triggered: string[] = [];
  const timers = new Map<number, () => void>();
  let nextId = 1;

  const watcher = new OnSaveWatcher({
    skipDirs: ["wiki", ".obsidian", ".trash"],
    isExtractionRunning: () => false,
    trigger: (path) => triggered.push(path),
    debounceMs: 100,
    setTimeout: (fn, _ms) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    ...overrides,
  });

  const flush = () => {
    for (const [id, fn] of timers) {
      fn();
      timers.delete(id);
    }
  };

  return { watcher, triggered, timers, flush };
}

describe("OnSaveWatcher", () => {
  it("triggers extraction after debounce", () => {
    const { watcher, triggered, flush } = createWatcher();
    watcher.handleModify("Notes/my-note.md");
    expect(triggered).toEqual([]);
    flush();
    expect(triggered).toEqual(["Notes/my-note.md"]);
  });

  it("debounces rapid saves on the same file", () => {
    const { watcher, triggered, timers, flush } = createWatcher();
    watcher.handleModify("Notes/my-note.md");
    watcher.handleModify("Notes/my-note.md");
    watcher.handleModify("Notes/my-note.md");
    // Only one timer should remain (previous two cleared).
    expect(timers.size).toBe(1);
    flush();
    expect(triggered).toEqual(["Notes/my-note.md"]);
  });

  it("tracks separate debounce timers per file", () => {
    const { watcher, triggered, flush } = createWatcher();
    watcher.handleModify("Notes/a.md");
    watcher.handleModify("Notes/b.md");
    flush();
    expect(triggered).toEqual(["Notes/a.md", "Notes/b.md"]);
  });

  it("skips files in skip directories", () => {
    const { watcher, triggered, flush } = createWatcher();
    watcher.handleModify("wiki/entities/alan-watts.md");
    watcher.handleModify(".obsidian/workspace.md");
    watcher.handleModify(".trash/old-note.md");
    flush();
    expect(triggered).toEqual([]);
  });

  it("skip dirs are case-insensitive", () => {
    const { watcher, triggered, flush } = createWatcher();
    watcher.handleModify("Wiki/something.md");
    flush();
    expect(triggered).toEqual([]);
  });

  it("skips trigger when extraction is already running", () => {
    let running = false;
    // Override with a watcher that checks running state.
    const triggered2: string[] = [];
    const timers2 = new Map<number, () => void>();
    let nextId2 = 1;
    const w2 = new OnSaveWatcher({
      skipDirs: ["wiki"],
      isExtractionRunning: () => running,
      trigger: (path) => triggered2.push(path),
      debounceMs: 100,
      setTimeout: (fn, _ms) => {
        const id = nextId2++;
        timers2.set(id, fn);
        return id;
      },
      clearTimeout: (handle) => {
        timers2.delete(handle as number);
      },
    });

    w2.handleModify("Notes/a.md");
    running = true;
    for (const [id, fn] of timers2) {
      fn();
      timers2.delete(id);
    }
    expect(triggered2).toEqual([]);
  });

  it("destroy cancels all pending timers", () => {
    const { watcher, timers } = createWatcher();
    watcher.handleModify("Notes/a.md");
    watcher.handleModify("Notes/b.md");
    expect(timers.size).toBe(2);
    watcher.destroy();
    expect(timers.size).toBe(0);
  });

  it("skips files outside included folders", () => {
    const { watcher, triggered, flush } = createWatcher({
      getIncludedFolders: () => ["Projects"],
    });
    watcher.handleModify("Projects/plan.md");
    watcher.handleModify("Notes/journal.md");
    flush();
    expect(triggered).toEqual(["Projects/plan.md"]);
  });
});
