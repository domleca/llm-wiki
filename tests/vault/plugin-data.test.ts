import { describe, it, expect } from "vitest";
import {
  loadEmbeddingsCache,
  saveEmbeddingsCache,
  type EmbeddingsCache,
} from "../../src/vault/plugin-data.js";
import { createMockApp } from "../helpers/mock-app.js";

describe("loadEmbeddingsCache / saveEmbeddingsCache", () => {
  it("returns an empty cache when no file exists", async () => {
    const { app } = createMockApp();
    const cache = await loadEmbeddingsCache(app as never);
    expect(cache.entries).toEqual({});
  });

  it("round-trips a cache object", async () => {
    const { app } = createMockApp();
    const cache: EmbeddingsCache = {
      entries: {
        "alan-watts": { sourceText: "Entity [person]: Alan Watts.", vector: [0.1, 0.2] },
      },
    };
    await saveEmbeddingsCache(app as never, cache);
    const read = await loadEmbeddingsCache(app as never);
    expect(read).toEqual(cache);
  });
});
