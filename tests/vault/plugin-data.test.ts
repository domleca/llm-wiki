import { describe, it, expect } from "vitest";
import {
  loadDreamState,
  saveDreamState,
  loadEmbeddingsCache,
  saveEmbeddingsCache,
  type DreamState,
  type EmbeddingsCache,
} from "../../src/vault/plugin-data.js";
import { createMockApp } from "../helpers/mock-app.js";

describe("loadDreamState / saveDreamState", () => {
  it("returns a default empty state when no file exists", async () => {
    const { app } = createMockApp();
    const state = await loadDreamState(app as never);
    expect(state.lastRun).toBeNull();
  });

  it("round-trips a state object", async () => {
    const { app } = createMockApp();
    const written: DreamState = { lastRun: "2026-04-07T00:00:01" };
    await saveDreamState(app as never, written);
    const read = await loadDreamState(app as never);
    expect(read).toEqual(written);
  });
});

describe("loadEmbeddingsCache / saveEmbeddingsCache", () => {
  it("returns an empty cache when no file exists", async () => {
    const { app } = createMockApp();
    const cache = await loadEmbeddingsCache(app as never);
    expect(cache.vaultId).toBe("");
    expect(cache.entries).toEqual({});
  });

  it("round-trips a cache object", async () => {
    const { app } = createMockApp();
    const cache: EmbeddingsCache = {
      vaultId: "test-vault-1",
      entries: {
        "alan-watts": { sourceText: "Entity [person]: Alan Watts.", vector: [0.1, 0.2] },
      },
    };
    await saveEmbeddingsCache(app as never, cache);
    const read = await loadEmbeddingsCache(app as never);
    expect(read).toEqual(cache);
  });
});
