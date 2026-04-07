import { describe, it, expect } from "vitest";
import { renderEntityPage } from "../../src/pages/render-entity.js";
import type { Entity, Connection } from "../../src/core/types.js";

const TODAY = "2026-04-07";

const ENTITY: Entity = {
  id: "alan-watts",
  name: "Alan Watts",
  type: "person",
  aliases: ["A.W. Watts"],
  facts: [
    "Author of The Wisdom of Insecurity",
    "Popularized Zen Buddhism in the West",
  ],
  sources: ["Books/Watts.md", "Learn/Zen.md"],
};

const CONNECTIONS: Connection[] = [
  {
    from: "alan-watts",
    to: "zen-buddhism",
    type: "influences",
    description: "Watts popularized Zen in the West",
    sources: ["Books/Watts.md"],
  },
];

describe("renderEntityPage", () => {
  it("starts with a valid YAML frontmatter block", () => {
    const md = renderEntityPage(ENTITY, [], TODAY);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("\n---\n");
  });

  it("has a h1 title matching entity name", () => {
    const md = renderEntityPage(ENTITY, [], TODAY);
    expect(md).toContain("\n# Alan Watts\n");
  });

  it("lists all facts under ## Facts", () => {
    const md = renderEntityPage(ENTITY, [], TODAY);
    expect(md).toContain("## Facts");
    expect(md).toContain("- Author of The Wisdom of Insecurity");
    expect(md).toContain("- Popularized Zen Buddhism in the West");
  });

  it("lists outgoing connections under ## Connections", () => {
    const md = renderEntityPage(ENTITY, CONNECTIONS, TODAY);
    expect(md).toContain("## Connections");
    expect(md).toContain("[[zen-buddhism]]");
    expect(md).toContain("influences");
  });

  it("lists incoming connections under ## Connections", () => {
    const incomingConn: Connection = {
      from: "dt-suzuki",
      to: "alan-watts",
      type: "influences",
      description: "",
      sources: [],
    };
    const md = renderEntityPage(ENTITY, [incomingConn], TODAY);
    expect(md).toContain("[[dt-suzuki]]");
  });

  it("lists sources under ## Sources as wikilinks", () => {
    const md = renderEntityPage(ENTITY, [], TODAY);
    expect(md).toContain("## Sources");
    expect(md).toContain("[[Books/Watts.md]]");
    expect(md).toContain("[[Learn/Zen.md]]");
  });

  it("omits ## Connections section when there are no connections", () => {
    const md = renderEntityPage(ENTITY, [], TODAY);
    expect(md).not.toContain("## Connections");
  });

  it("omits ## Facts section when entity has no facts", () => {
    const e = { ...ENTITY, facts: [] };
    const md = renderEntityPage(e, [], TODAY);
    expect(md).not.toContain("## Facts");
  });

  it("output ends with a newline", () => {
    const md = renderEntityPage(ENTITY, [], TODAY);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("omits ## Sources section when entity has no sources", () => {
    const e = { ...ENTITY, sources: [] };
    const md = renderEntityPage(e, [], TODAY);
    expect(md).not.toContain("## Sources");
  });
});
