import { describe, it, expect } from "vitest";
import {
  formatEta,
  formatIndexingLabel,
} from "../../src/ui/status-bar-format.js";

describe("formatEta", () => {
  it("returns 'estimating…' until 3 files have completed", () => {
    expect(formatEta(1_000, 0, 10)).toBe("estimating…");
    expect(formatEta(1_000, 1, 10)).toBe("estimating…");
    expect(formatEta(1_000, 2, 10)).toBe("estimating…");
  });

  it("returns a seconds estimate when the total remaining is under a minute", () => {
    // 3 files in 3s = 1s each; 7 left => ~7s.
    expect(formatEta(3_000, 3, 10)).toBe("~7s");
  });

  it("returns a minutes estimate when remaining is under an hour", () => {
    // 3 files in 180_000 ms (1 minute each); 10 left => 10 minutes.
    expect(formatEta(180_000, 3, 13)).toBe("~10m");
  });

  it("returns an h+m estimate for longer runs", () => {
    // 3 files in 360_000ms (2 min each); 100 left => 200 minutes = 3h 20m.
    expect(formatEta(360_000, 3, 103)).toBe("~3h 20m");
  });

  it("returns 'done' when nothing remains", () => {
    expect(formatEta(10_000, 10, 10)).toBe("done");
  });
});

describe("formatIndexingLabel", () => {
  it("composes the idle-state label", () => {
    expect(formatIndexingLabel({ state: "idle" })).toBe("🧠 LLM Wiki");
  });

  it("composes the indexing-state label with ETA", () => {
    expect(
      formatIndexingLabel({
        state: "indexing",
        processed: 3,
        total: 10,
        elapsedMs: 3_000,
      }),
    ).toBe("🧠 Indexing 3/10 · ~7s");
  });

  it("composes the indexing-state label while estimating", () => {
    expect(
      formatIndexingLabel({
        state: "indexing",
        processed: 1,
        total: 10,
        elapsedMs: 1_000,
      }),
    ).toBe("🧠 Indexing 1/10 · estimating…");
  });

  it("composes the error-state label", () => {
    expect(
      formatIndexingLabel({ state: "error", message: "Ollama unreachable" }),
    ).toBe("🧠 ⚠ Ollama unreachable");
  });
});
