import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";

describe("KnowledgeBase — construction", () => {
  it("starts empty when no data is given", () => {
    const kb = new KnowledgeBase();
    expect(kb.data.entities).toEqual({});
    expect(kb.data.concepts).toEqual({});
    expect(kb.data.connections).toEqual([]);
    expect(kb.data.sources).toEqual({});
    expect(kb.data.meta.version).toBe(1);
    expect(kb.data.meta.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(kb.data.meta.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("loads from a pre-built data object", () => {
    const data = {
      meta: { version: 1, created: "2026-01-01", updated: "2026-01-02" },
      entities: {
        "alan-watts": {
          id: "alan-watts",
          name: "Alan Watts",
          type: "person" as const,
          aliases: [],
          facts: ["Author of Wisdom of Insecurity"],
          sources: ["Books/Watts.md"],
        },
      },
      concepts: {},
      connections: [],
      sources: {},
    };
    const kb = new KnowledgeBase(data);
    expect(kb.data.entities["alan-watts"]?.name).toBe("Alan Watts");
  });
});
