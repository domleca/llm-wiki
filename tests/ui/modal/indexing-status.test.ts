import { describe, it, expect } from "vitest";
import { formatIndexingStatus } from "../../../src/ui/modal/indexing-status.js";

describe("formatIndexingStatus", () => {
  it("returns 'Preparing…' for idle", () => {
    expect(formatIndexingStatus({ kind: "idle" })).toBe("Preparing…");
  });

  it("shows 'Building index…' before the first item is processed", () => {
    expect(
      formatIndexingStatus({
        kind: "building",
        progress: { current: 0, total: 0 },
      }),
    ).toBe("Building index…");
  });

  it("shows current/total when total is known", () => {
    expect(
      formatIndexingStatus({
        kind: "building",
        progress: { current: 3, total: 12 },
      }),
    ).toBe("Building index… 3 / 12");
  });

  it("returns 'Ready' when ready", () => {
    expect(
      formatIndexingStatus({
        kind: "ready",
        index: new Map(),
      }),
    ).toBe("Ready");
  });

  it("returns a fallback warning when in a non-connect error", () => {
    expect(
      formatIndexingStatus({
        kind: "error",
        message: "ollama down",
        reason: "other",
      }),
    ).toBe("Embedding index unavailable (ollama down) — keyword-only fallback");
  });

  it("shows the disconnected hint when the error reason is connect", () => {
    expect(
      formatIndexingStatus({
        kind: "error",
        message: "fetch failed",
        reason: "connect",
      }),
    ).toBe("Ollama disconnected — click to retry");
  });
});
