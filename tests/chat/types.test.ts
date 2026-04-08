import { describe, it, expect } from "vitest";
import type { Chat, ChatTurn } from "../../src/chat/types.js";

describe("chat types", () => {
  it("compiles with the expected shape", () => {
    const turn: ChatTurn = {
      question: "q",
      answer: "a",
      sourceIds: ["a/b.md"],
      rewrittenQuery: null,
      createdAt: 1,
    };
    const chat: Chat = {
      id: "c1",
      title: "Untitled",
      createdAt: 1,
      updatedAt: 1,
      folder: "",
      model: "qwen2.5:7b",
      turns: [turn],
    };
    expect(chat.turns[0].question).toBe("q");
  });
});
