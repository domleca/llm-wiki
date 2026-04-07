import { describe, it, expect } from "vitest";
import { renderConceptPage } from "../../src/pages/render-concept.js";
import type { Concept } from "../../src/core/types.js";

const TODAY = "2026-04-07";

const CONCEPT: Concept = {
  id: "zen-buddhism",
  name: "Zen Buddhism",
  definition: "Direct experience over scriptural study, emphasizing meditation",
  related: ["Alan Watts", "D.T. Suzuki"],
  sources: ["Books/Watts.md", "Learn/Zen.md"],
};

describe("renderConceptPage", () => {
  it("starts with YAML frontmatter", () => {
    const md = renderConceptPage(CONCEPT, TODAY);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("\n---\n");
  });

  it("has a h1 title matching concept name", () => {
    const md = renderConceptPage(CONCEPT, TODAY);
    expect(md).toContain("\n# Zen Buddhism\n");
  });

  it("includes the definition as a paragraph", () => {
    const md = renderConceptPage(CONCEPT, TODAY);
    expect(md).toContain("Direct experience over scriptural study");
  });

  it("lists related items as wikilinks under ## Related", () => {
    const md = renderConceptPage(CONCEPT, TODAY);
    expect(md).toContain("## Related");
    expect(md).toContain("[[alan-watts|Alan Watts]]");
    expect(md).toContain("[[dt-suzuki|D.T. Suzuki]]");
  });

  it("lists sources as wikilinks under ## Sources", () => {
    const md = renderConceptPage(CONCEPT, TODAY);
    expect(md).toContain("## Sources");
    expect(md).toContain("[[Books/Watts.md]]");
  });

  it("omits ## Related when related list is empty", () => {
    const c = { ...CONCEPT, related: [] };
    const md = renderConceptPage(c, TODAY);
    expect(md).not.toContain("## Related");
  });

  it("output ends with a newline", () => {
    const md = renderConceptPage(CONCEPT, TODAY);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("omits the definition paragraph when definition is empty", () => {
    const c = { ...CONCEPT, definition: "" };
    const md = renderConceptPage(c, TODAY);
    // After the h1, the next non-blank content should be a section or end of file
    const lines = md.split("\n");
    const h1Index = lines.findIndex((l) => l.startsWith("# "));
    const afterH1 = lines.slice(h1Index + 1).filter((l) => l.trim() !== "");
    // Should start with ## or nothing, not a definition paragraph
    expect(afterH1[0] ?? "").toMatch(/^(##|$)/);
  });

  it("omits ## Sources section when concept has no sources", () => {
    const c = { ...CONCEPT, sources: [] };
    const md = renderConceptPage(c, TODAY);
    expect(md).not.toContain("## Sources");
  });
});
