/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { ChatTranscript } from "../../../src/ui/modal/chat-transcript.js";
import { createChat, appendTurn } from "../../../src/chat/store.js";

const renderMarkdown = (el: HTMLElement, md: string): void => {
  el.textContent = md;
};

describe("ChatTranscript", () => {
  it("renders all turns of a chat", () => {
    const root = document.createElement("div");
    const t = new ChatTranscript(root, { renderMarkdown });
    let chat = createChat({ id: "a", now: 0, folder: "", model: "m" });
    chat = appendTurn(
      chat,
      {
        question: "q1",
        answer: "a1",
        sourceIds: ["x.md"],
        rewrittenQuery: null,
        createdAt: 1,
      },
      1,
    );
    t.renderChat(chat);
    expect(root.querySelectorAll(".turn")).toHaveLength(1);
    expect(root.querySelector(".turn-q")?.textContent).toBe("q1");
    expect(root.querySelector(".turn-a")?.textContent).toBe("a1");
    // Sources are consolidated in a single footer
    expect(root.querySelector(".transcript-sources-label")?.textContent).toBe(
      "Sources (1)",
    );
    expect(root.querySelector(".transcript-source-item")?.textContent).toBe("x.md");
  });

  it("streams an answer via beginTurn → appendAnswerChunk → setSources → finalize", () => {
    const root = document.createElement("div");
    const t = new ChatTranscript(root, { renderMarkdown });
    const h = t.beginTurn("hello?");
    h.appendAnswerChunk("Hi");
    h.appendAnswerChunk(" there");
    h.setSources(["a.md", "b.md"]);
    h.finalize();
    expect(root.querySelector(".turn-q")?.textContent).toBe("hello?");
    // Sources consolidated at bottom
    expect(root.querySelector(".transcript-sources-label")?.textContent).toBe(
      "Sources (2)",
    );
    expect(root.querySelectorAll(".transcript-source-item")).toHaveLength(2);
  });

  it("clear() empties the transcript", () => {
    const root = document.createElement("div");
    const t = new ChatTranscript(root, { renderMarkdown });
    t.beginTurn("q").finalize();
    expect(root.querySelectorAll(".turn")).toHaveLength(1);
    t.clear();
    expect(root.querySelectorAll(".turn")).toHaveLength(0);
  });

  it("renderChat with multiple turns appends them in order", () => {
    const root = document.createElement("div");
    const t = new ChatTranscript(root, { renderMarkdown });
    let chat = createChat({ id: "a", now: 0, folder: "", model: "m" });
    chat = appendTurn(
      chat,
      { question: "first", answer: "1", sourceIds: [], rewrittenQuery: null, createdAt: 1 },
      1,
    );
    chat = appendTurn(
      chat,
      { question: "second", answer: "2", sourceIds: [], rewrittenQuery: null, createdAt: 2 },
      2,
    );
    t.renderChat(chat);
    const qs = [...root.querySelectorAll(".turn-q")].map((e) => e.textContent);
    expect(qs).toEqual(["first", "second"]);
  });

  it("deduplicates sources across turns", () => {
    const root = document.createElement("div");
    const t = new ChatTranscript(root, { renderMarkdown });
    let chat = createChat({ id: "a", now: 0, folder: "", model: "m" });
    chat = appendTurn(
      chat,
      { question: "q1", answer: "a1", sourceIds: ["x.md", "y.md"], rewrittenQuery: null, createdAt: 1 },
      1,
    );
    chat = appendTurn(
      chat,
      { question: "q2", answer: "a2", sourceIds: ["y.md", "z.md"], rewrittenQuery: null, createdAt: 2 },
      2,
    );
    t.renderChat(chat);
    expect(root.querySelector(".transcript-sources-label")?.textContent).toBe(
      "Sources (3)",
    );
    expect(root.querySelectorAll(".transcript-source-item")).toHaveLength(3);
  });
});
