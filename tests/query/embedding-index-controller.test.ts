import { describe, it, expect } from "vitest";
import {
  EmbeddingIndexController,
  type EmbeddingIndexState,
} from "../../src/query/embedding-index-controller.js";

function recordingController(opts: {
  buildResult?: ReadonlyMap<string, number[]>;
  buildError?: Error;
  emitProgress?: Array<{ current: number; total: number }>;
}): {
  controller: EmbeddingIndexController;
  states: EmbeddingIndexState[];
  buildCalls: number;
} {
  const states: EmbeddingIndexState[] = [];
  let buildCalls = 0;
  const controller = new EmbeddingIndexController({
    buildIndex: async (onProgress) => {
      buildCalls += 1;
      for (const p of opts.emitProgress ?? []) onProgress(p);
      if (opts.buildError) throw opts.buildError;
      return opts.buildResult ?? new Map();
    },
  });
  controller.subscribe((s) => states.push(s));
  return { controller, states, buildCalls };
}

describe("EmbeddingIndexController", () => {
  it("starts in idle state", () => {
    const { controller } = recordingController({});
    expect(controller.getState().kind).toBe("idle");
  });

  it("transitions idle → building → ready on a successful build", async () => {
    const result = new Map<string, number[]>([["a", [1, 0]]]);
    const { controller, states } = recordingController({
      buildResult: result,
      emitProgress: [
        { current: 1, total: 2 },
        { current: 2, total: 2 },
      ],
    });
    const index = await controller.ensureBuilt();
    expect(index).toBe(result);
    expect(states.map((s) => s.kind)).toEqual([
      "building",
      "building",
      "building",
      "ready",
    ]);
    const lastBuilding = states[2];
    if (lastBuilding.kind !== "building") throw new Error("expected building");
    expect(lastBuilding.progress).toEqual({ current: 2, total: 2 });
    const ready = states[3];
    if (ready.kind !== "ready") throw new Error("expected ready");
    expect(ready.index).toBe(result);
  });
});
