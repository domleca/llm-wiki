import { describe, it, expect } from "vitest";
import {
  EmbeddingIndexController,
  type EmbeddingIndexState,
} from "../../src/query/embedding-index-controller.js";
import { LLMConnectError } from "../../src/llm/provider.js";

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

  it("returns the same promise when ensureBuilt is called concurrently", async () => {
    let resolveBuild: (idx: ReadonlyMap<string, number[]>) => void = () => {};
    let buildCalls = 0;
    const controller = new EmbeddingIndexController({
      buildIndex: () => {
        buildCalls += 1;
        return new Promise((res) => {
          resolveBuild = res;
        });
      },
    });
    const a = controller.ensureBuilt();
    const b = controller.ensureBuilt();
    expect(a).toBe(b);
    expect(buildCalls).toBe(1);
    resolveBuild(new Map([["x", [1]]]));
    await a;
  });

  it("does not rebuild after reaching ready", async () => {
    let buildCalls = 0;
    const controller = new EmbeddingIndexController({
      buildIndex: () => {
        buildCalls += 1;
        return Promise.resolve(new Map([["x", [1]]]));
      },
    });
    await controller.ensureBuilt();
    await controller.ensureBuilt();
    expect(buildCalls).toBe(1);
  });

  it("transitions to error with an empty fallback when buildIndex throws", async () => {
    const { controller, states } = recordingController({
      buildError: new Error("ollama down"),
    });
    const index = await controller.ensureBuilt();
    expect(index.size).toBe(0);
    const last = states[states.length - 1]!;
    if (last.kind !== "error") throw new Error("expected error state");
    expect(last.message).toBe("ollama down");
    expect(last.reason).toBe("other");
  });

  it("classifies LLMConnectError as a connect-reason error", async () => {
    const { controller, states } = recordingController({
      buildError: new LLMConnectError("fetch failed: ECONNREFUSED"),
    });
    await controller.ensureBuilt();
    const last = states[states.length - 1]!;
    if (last.kind !== "error") throw new Error("expected error state");
    expect(last.reason).toBe("connect");
    expect(last.message).toContain("ECONNREFUSED");
  });

  it("does not retry after landing in error (without explicit retry)", async () => {
    let calls = 0;
    const controller = new EmbeddingIndexController({
      buildIndex: async () => {
        calls += 1;
        throw new Error("nope");
      },
    });
    await controller.ensureBuilt();
    await controller.ensureBuilt();
    expect(calls).toBe(1);
    expect(controller.getState().kind).toBe("error");
  });

  it("retry() resets an error state and re-runs the build", async () => {
    let calls = 0;
    let nextResult: ReadonlyMap<string, number[]> | null = null;
    const controller = new EmbeddingIndexController({
      buildIndex: async () => {
        calls += 1;
        if (nextResult) return nextResult;
        throw new LLMConnectError("ollama down");
      },
    });
    await controller.ensureBuilt();
    expect(controller.getState().kind).toBe("error");
    nextResult = new Map([["a", [1, 2]]]);
    const idx = await controller.retry();
    expect(calls).toBe(2);
    expect(controller.getState().kind).toBe("ready");
    expect(idx.size).toBe(1);
  });

  it("retry() is a no-op when not in error", async () => {
    let calls = 0;
    const controller = new EmbeddingIndexController({
      buildIndex: () => {
        calls += 1;
        return Promise.resolve(new Map([["x", [1]]]));
      },
    });
    await controller.ensureBuilt();
    await controller.retry();
    expect(calls).toBe(1);
    expect(controller.getState().kind).toBe("ready");
  });
});
