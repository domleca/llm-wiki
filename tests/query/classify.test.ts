import { describe, it, expect } from "vitest";
import { classifyQuery } from "../../src/query/classify.js";

describe("classifyQuery", () => {
  it("detects list_category questions", () => {
    expect(classifyQuery("what books did Alan Watts write")).toBe("list_category");
    expect(classifyQuery("list all the people in the kb")).toBe("list_category");
    expect(classifyQuery("how many tools are mentioned")).toBe("list_category");
  });

  it("detects entity_lookup questions", () => {
    expect(classifyQuery("who is Alan Watts")).toBe("entity_lookup");
    expect(classifyQuery("tell me about Karpathy")).toBe("entity_lookup");
    expect(classifyQuery("what is zen")).toBe("entity_lookup");
  });

  it("detects relational questions", () => {
    expect(classifyQuery("how does Alan Watts relate to zen")).toBe("relational");
    expect(classifyQuery("what is the connection between A and B")).toBe(
      "relational",
    );
  });

  it("falls back to conceptual for everything else", () => {
    expect(classifyQuery("explain the law of reversed effort")).toBe("conceptual");
  });
});
