import { describe, it, expect } from "vitest";
import { appendInteractionLog } from "../../src/vault/interaction-log.js";
import { createMockApp } from "../helpers/mock-app.js";

describe("appendInteractionLog", () => {
  it("appends a JSON line to today's log file", async () => {
    const { app, files } = createMockApp();
    const now = () => new Date("2026-04-09T12:00:00Z");
    await appendInteractionLog(
      app as never,
      {
        question: "q",
        answer: "a",
        model: "m",
        queryType: "entity_lookup",
        entityCount: 1,
        conceptCount: 0,
        elapsedMs: 100,
      },
      now,
    );
    const path = ".obsidian/plugins/llm-wiki/interactions/2026-04-09.jsonl";
    const content = files.get(path)?.content;
    expect(content).toBeDefined();
    expect(content).toMatch(/\n$/);
    const parsed = JSON.parse(content!.trim());
    expect(parsed.question).toBe("q");
    expect(parsed.answer).toBe("a");
    expect(parsed.model).toBe("m");
    expect(parsed.queryType).toBe("entity_lookup");
    expect(parsed.entityCount).toBe(1);
    expect(parsed.conceptCount).toBe(0);
    expect(parsed.elapsedMs).toBe(100);
    expect(parsed.timestamp).toBe("2026-04-09T12:00:00.000Z");
  });

  it("appends multiple entries to the same day file", async () => {
    const { app, files } = createMockApp();
    const now = () => new Date("2026-04-09T12:00:00Z");
    await appendInteractionLog(
      app as never,
      {
        question: "q1",
        answer: "a1",
        model: "m",
        queryType: "entity_lookup",
        entityCount: 0,
        conceptCount: 0,
        elapsedMs: 10,
      },
      now,
    );
    await appendInteractionLog(
      app as never,
      {
        question: "q2",
        answer: "a2",
        model: "m",
        queryType: "concept_lookup",
        entityCount: 0,
        conceptCount: 1,
        elapsedMs: 20,
      },
      now,
    );
    const path = ".obsidian/plugins/llm-wiki/interactions/2026-04-09.jsonl";
    const content = files.get(path)?.content ?? "";
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).question).toBe("q1");
    expect(JSON.parse(lines[1]!).question).toBe("q2");
  });

  it("defaults to real Date when no clock injected", async () => {
    const { app, files } = createMockApp();
    await appendInteractionLog(app as never, {
      question: "q",
      answer: "a",
      model: "m",
      queryType: "generic",
      entityCount: 0,
      conceptCount: 0,
      elapsedMs: 1,
    });
    // Just check that some file was written under interactions/
    const written = Array.from(files.keys()).filter((p) =>
      p.startsWith(".obsidian/plugins/llm-wiki/interactions/"),
    );
    expect(written.length).toBe(1);
  });
});
