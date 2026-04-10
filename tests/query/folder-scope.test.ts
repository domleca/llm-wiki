import { describe, it, expect } from "vitest";
import { filterBundleByFolder } from "../../src/query/folder-scope.js";
import type { RetrievedBundle } from "../../src/query/types.js";

const bundle: RetrievedBundle = {
  question: "q",
  queryType: "entity_lookup",
  entities: [
    {
      id: "a",
      name: "A",
      type: "person",
      aliases: [],
      facts: ["f"],
      sources: ["Books/A.md"],
    },
    {
      id: "b",
      name: "B",
      type: "person",
      aliases: [],
      facts: ["f"],
      sources: ["Other/B.md"],
    },
    {
      id: "c",
      name: "C",
      type: "person",
      aliases: [],
      facts: ["f"],
      sources: ["Projects/C.md"],
    },
  ],
  concepts: [],
  connections: [],
  sources: [
    { id: "Books/A.md", summary: "", date: "2026-01-01", mtime: 0, origin: "user-note" },
    { id: "Other/B.md", summary: "", date: "2026-01-01", mtime: 0, origin: "user-note" },
    { id: "Projects/C.md", summary: "", date: "2026-01-01", mtime: 0, origin: "user-note" },
  ],
};

describe("filterBundleByFolder", () => {
  it("keeps only items inside the specified folder", () => {
    const filtered = filterBundleByFolder(bundle, ["Books"]);
    expect(filtered.entities.map((e) => e.name)).toEqual(["A"]);
    expect(filtered.sources.map((s) => s.id)).toEqual(["Books/A.md"]);
  });

  it("returns the bundle unchanged when folders array is empty", () => {
    const filtered = filterBundleByFolder(bundle, []);
    expect(filtered.entities.length).toBe(3);
  });

  it("keeps items from any of multiple folders", () => {
    const filtered = filterBundleByFolder(bundle, ["Books", "Projects"]);
    expect(filtered.entities.map((e) => e.name)).toEqual(["A", "C"]);
    expect(filtered.sources.map((s) => s.id)).toEqual(["Books/A.md", "Projects/C.md"]);
  });

  it("handles folder paths with and without trailing slashes", () => {
    const filtered1 = filterBundleByFolder(bundle, ["Books/"]);
    const filtered2 = filterBundleByFolder(bundle, ["Books"]);
    expect(filtered1.entities.length).toBe(filtered2.entities.length);
  });
});
