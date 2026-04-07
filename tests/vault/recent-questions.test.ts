import { describe, it, expect } from "vitest";
import {
  pushRecentQuestion,
  loadRecentQuestions,
  saveRecentQuestions,
} from "../../src/vault/recent-questions.js";
import { createMockApp } from "../helpers/mock-app.js";

describe("pushRecentQuestion", () => {
  it("pushes and trims to N", () => {
    const list: string[] = [];
    const next = pushRecentQuestion(list, "first", 3);
    const next2 = pushRecentQuestion(next, "second", 3);
    const next3 = pushRecentQuestion(next2, "third", 3);
    const next4 = pushRecentQuestion(next3, "fourth", 3);
    expect(next4).toEqual(["fourth", "third", "second"]);
  });

  it("dedupes by promoting an existing question to the front", () => {
    const list = ["c", "b", "a"];
    expect(pushRecentQuestion(list, "b", 5)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate its input list", () => {
    const list = ["a", "b"];
    const copy = [...list];
    pushRecentQuestion(list, "c", 5);
    expect(list).toEqual(copy);
  });

  it("treats max=0 as clearing the list", () => {
    expect(pushRecentQuestion(["a", "b"], "c", 0)).toEqual([]);
  });
});

describe("loadRecentQuestions / saveRecentQuestions", () => {
  it("round-trips via load/save", async () => {
    const { app } = createMockApp();
    await saveRecentQuestions(app as never, ["q1", "q2"]);
    expect(await loadRecentQuestions(app as never)).toEqual(["q1", "q2"]);
  });

  it("returns empty list when file does not exist", async () => {
    const { app } = createMockApp();
    expect(await loadRecentQuestions(app as never)).toEqual([]);
  });

  it("returns empty list when file is malformed JSON", async () => {
    const { app } = createMockApp();
    await app.vault.adapter.write(
      ".obsidian/plugins/llm-wiki/recent-questions.json",
      "{not json",
    );
    expect(await loadRecentQuestions(app as never)).toEqual([]);
  });

  it("returns empty list when file is a JSON array of non-strings", async () => {
    const { app } = createMockApp();
    await app.vault.adapter.write(
      ".obsidian/plugins/llm-wiki/recent-questions.json",
      JSON.stringify([1, 2, 3]),
    );
    expect(await loadRecentQuestions(app as never)).toEqual([]);
  });
});
