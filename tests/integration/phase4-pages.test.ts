import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { runExtraction } from "../../src/extract/queue.js";
import { generatePages } from "../../src/pages/generator.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";
import { ProgressEmitter } from "../../src/runtime/progress.js";
import { createMockApp } from "../helpers/mock-app.js";
import { saveKB, loadKB } from "../../src/vault/kb-store.js";

const WATTS_RESPONSE = JSON.stringify({
  source_summary: "Notes on Alan Watts.",
  entities: [
    {
      name: "Alan Watts",
      type: "person",
      aliases: [],
      facts: ["Wrote The Wisdom of Insecurity", "Popularized Zen in the West"],
    },
  ],
  concepts: [
    {
      name: "Zen Buddhism",
      definition: "Direct experience over scriptural study",
      related: ["Alan Watts"],
    },
  ],
  connections: [
    {
      from: "Alan Watts",
      to: "Zen Buddhism",
      type: "influences",
      description: "Watts brought Zen to the West",
    },
  ],
});

function longBody(topic: string): string {
  return `This is a long note about ${topic}. `.repeat(20);
}

describe("Phase 4 integration: extraction → page generation", () => {
  it("writes quality entity and concept pages after a full extraction", async () => {
    const { app, files } = createMockApp();
    const now = Date.now();
    files.set("Books/Watts.md", {
      path: "Books/Watts.md",
      content: longBody("Alan Watts"),
      mtime: now,
      ctime: now,
    });
    files.set("Learn/Zen.md", {
      path: "Learn/Zen.md",
      content: longBody("Zen Buddhism"),
      mtime: now,
      ctime: now,
    });

    const kb = new KnowledgeBase();
    let kbMtime = 0;
    const emitter = new ProgressEmitter();
    const provider = new MockLLMProvider([WATTS_RESPONSE, WATTS_RESPONSE]);

    await runExtraction({
      provider,
      kb,
      files: [
        { path: "Books/Watts.md", content: longBody("Alan Watts"), mtime: now, contentHash: "watts", origin: "user-note" },
        { path: "Learn/Zen.md", content: longBody("Zen Buddhism"), mtime: now, contentHash: "zen", origin: "user-note" },
      ],
      model: "qwen2.5:7b",
      saveKB: async () => {
        await saveKB(app as never, kb, kbMtime);
        kbMtime = (await loadKB(app as never)).mtime;
      },
      emitter,
      checkpointEvery: 5,
    });

    await generatePages(app as never, kb);

    // Alan Watts has 2 facts and 2 sources → entity page generated
    expect(files.has("wiki/entities/alan-watts.md")).toBe(true);
    // Zen Buddhism has a definition → concept page generated
    expect(files.has("wiki/concepts/zen-buddhism.md")).toBe(true);
    // source pages generated
    expect(files.has("wiki/sources/Books/Watts.md")).toBe(true);
    expect(files.has("wiki/sources/Learn/Zen.md")).toBe(true);
  });

  it("generated entity page contains valid frontmatter block", async () => {
    const { app, files } = createMockApp();
    const now = Date.now();

    const kb = new KnowledgeBase();
    let kbMtime = 0;
    const emitter = new ProgressEmitter();
    const provider = new MockLLMProvider([WATTS_RESPONSE, WATTS_RESPONSE]);

    await runExtraction({
      provider,
      kb,
      files: [
        { path: "Books/Watts.md", content: longBody("Alan Watts"), mtime: now, contentHash: "watts", origin: "user-note" },
        { path: "Learn/Zen.md", content: longBody("Zen"), mtime: now, contentHash: "zen-short", origin: "user-note" },
      ],
      model: "qwen2.5:7b",
      saveKB: async () => {
        await saveKB(app as never, kb, kbMtime);
        kbMtime = (await loadKB(app as never)).mtime;
      },
      emitter,
    });

    await generatePages(app as never, kb);

    const entityContent = files.get("wiki/entities/alan-watts.md")!.content;
    // Must start with YAML frontmatter
    expect(entityContent).toMatch(/^---\n/);
    expect(entityContent).toContain("\n---\n");
    // Must contain the entity name
    expect(entityContent).toContain("Alan Watts");
  });

  it("filter enforcement: only quality entities get pages", async () => {
    const { app, files } = createMockApp();

    const kb = new KnowledgeBase();
    // rich: 3 facts, 2 sources → passes
    kb.addEntity({ name: "Rich Entity", type: "person", facts: ["f1", "f2", "f3"], source: "a.md" });
    kb.addEntity({ name: "Rich Entity", type: "person", source: "b.md" });
    // another rich: 2 facts, 2 sources → passes
    kb.addEntity({ name: "Second Entity", type: "org", facts: ["f1", "f2"], source: "c.md" });
    kb.addEntity({ name: "Second Entity", type: "org", source: "d.md" });
    // thin: 1 fact, 1 source → fails
    kb.addEntity({ name: "Thin Entity", type: "other", facts: ["only"], source: "e.md" });

    await generatePages(app as never, kb);

    const entityPages = Array.from(files.keys()).filter((p) =>
      p.startsWith("wiki/entities/"),
    );
    expect(entityPages).toHaveLength(2);
    expect(files.has("wiki/entities/rich-entity.md")).toBe(true);
    expect(files.has("wiki/entities/second-entity.md")).toBe(true);
    expect(files.has("wiki/entities/thin-entity.md")).toBe(false);
  });

  it("regenerate prunes stale pages when entity is removed", async () => {
    const { app, files } = createMockApp();
    const kb = new KnowledgeBase();

    // First run: entity passes filter (2 facts, 2 sources)
    kb.addEntity({ name: "Rich Entity", type: "person", facts: ["f1", "f2"], source: "a.md" });
    kb.addEntity({ name: "Rich Entity", type: "person", source: "b.md" });
    await generatePages(app as never, kb);
    expect(files.has("wiki/entities/rich-entity.md")).toBe(true);

    // Remove the entity's source so it no longer qualifies
    kb.removeSource("a.md");
    kb.removeSource("b.md");
    await generatePages(app as never, kb);

    // Entity no longer passes → page deleted
    expect(files.has("wiki/entities/rich-entity.md")).toBe(false);
  });
});
