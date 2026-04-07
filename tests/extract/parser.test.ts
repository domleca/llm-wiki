import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseExtraction } from "../../src/extract/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixDir = join(here, "..", "fixtures", "raw-llm-responses");
const fx = (name: string): string => readFileSync(join(fixDir, name), "utf8");

describe("parseExtraction — happy path", () => {
  it("parses clean JSON into the expected shape", () => {
    const parsed = parseExtraction(fx("happy.txt"));
    expect(parsed).not.toBeNull();
    expect(parsed!.source_summary).toMatch(/Alan Watts/);
    expect(parsed!.entities).toHaveLength(1);
    expect(parsed!.entities[0]!.name).toBe("Alan Watts");
    expect(parsed!.entities[0]!.type).toBe("person");
    expect(parsed!.concepts).toHaveLength(1);
    expect(parsed!.concepts[0]!.name).toBe("Zen");
    expect(parsed!.connections).toHaveLength(1);
  });

  it("returns default empty arrays if the model omits a field", () => {
    const parsed = parseExtraction('{"source_summary": "only a summary"}');
    expect(parsed).not.toBeNull();
    expect(parsed!.entities).toEqual([]);
    expect(parsed!.concepts).toEqual([]);
    expect(parsed!.connections).toEqual([]);
  });
});

describe("parseExtraction — 7B model quirks", () => {
  it("strips markdown ```json fences", () => {
    const parsed = parseExtraction(fx("markdown-fenced.txt"));
    expect(parsed).not.toBeNull();
    expect(parsed!.entities[0]!.name).toBe("X");
  });

  it("forgives trailing commas inside arrays and objects", () => {
    const parsed = parseExtraction(fx("trailing-commas.txt"));
    expect(parsed).not.toBeNull();
    expect(parsed!.entities).toHaveLength(1);
    expect(parsed!.entities[0]!.name).toBe("Foo");
  });

  it("extracts the outermost object from preamble/postamble noise", () => {
    const parsed = parseExtraction(fx("preamble-postamble.txt"));
    expect(parsed).not.toBeNull();
    expect(parsed!.entities[0]!.name).toBe("Bar");
  });
});

describe("parseExtraction — failure modes", () => {
  it("returns null on empty input", () => {
    expect(parseExtraction("")).toBeNull();
    expect(parseExtraction("   \n  ")).toBeNull();
    expect(parseExtraction(fx("empty.txt"))).toBeNull();
  });

  it("returns null when no JSON object is present", () => {
    expect(parseExtraction(fx("no-braces.txt"))).toBeNull();
  });

  it("returns null on unparseable JSON even after cleanup", () => {
    expect(parseExtraction("{ this: is not: json }")).toBeNull();
  });

  it("returns null when the top-level value is not an object", () => {
    expect(parseExtraction("[1,2,3]")).toBeNull();
  });
});
