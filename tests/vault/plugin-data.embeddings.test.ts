import { describe, it, expect } from "vitest";
import {
  loadEmbeddingsCache,
  saveEmbeddingsCache,
} from "../../src/vault/plugin-data.js";
import { createMockApp } from "../helpers/mock-app.js";

describe("embeddings cache", () => {
  it("returns a fresh cache when file is missing", async () => {
    const { app } = createMockApp();
    const c = await loadEmbeddingsCache(app as never);
    expect(c.entries).toEqual({});
  });

  it("round-trips via save/load", async () => {
    const { app } = createMockApp();
    await saveEmbeddingsCache(app as never, {
      entries: {
        "alan-watts": { sourceText: "x", vector: [1, 2, 3] },
      },
    });
    const c = await loadEmbeddingsCache(app as never);
    expect(c.entries["alan-watts"]?.vector).toEqual([1, 2, 3]);
    expect(c.entries["alan-watts"]?.sourceText).toBe("x");
  });

  it("preserves multiple entries across save/load", async () => {
    const { app } = createMockApp();
    await saveEmbeddingsCache(app as never, {
      entries: {
        "alan-watts": { sourceText: "a", vector: [0.1, 0.2] },
        "zen-buddhism": { sourceText: "z", vector: [0.3, 0.4] },
      },
    });
    const c = await loadEmbeddingsCache(app as never);
    expect(Object.keys(c.entries).sort()).toEqual(["alan-watts", "zen-buddhism"]);
    expect(c.entries["zen-buddhism"]?.vector).toEqual([0.3, 0.4]);
  });
});
