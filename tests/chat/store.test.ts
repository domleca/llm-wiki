import { describe, it, expect } from "vitest";
import {
  createChat,
  appendTurn,
  updateChatTitle,
  renameChat,
  deleteChat,
  sortChatsByRecency,
} from "../../src/chat/store.js";
import type { Chat, ChatTurn } from "../../src/chat/types.js";

const turn = (q: string, t: number): ChatTurn => ({
  question: q,
  answer: `ans-${q}`,
  sourceIds: [],
  rewrittenQuery: null,
  createdAt: t,
});

describe("createChat", () => {
  it("makes a chat with a fresh id, empty turns, and matching timestamps", () => {
    const c = createChat({ id: "id1", now: 100, folder: "", model: "m" });
    expect(c.id).toBe("id1");
    expect(c.turns).toEqual([]);
    expect(c.title).toBe("Untitled");
    expect(c.createdAt).toBe(100);
    expect(c.updatedAt).toBe(100);
  });
});

describe("appendTurn", () => {
  it("appends and bumps updatedAt without mutating input", () => {
    const c = createChat({ id: "a", now: 1, folder: "", model: "m" });
    const t = turn("q1", 5);
    const next = appendTurn(c, t, 5);
    expect(next.turns).toHaveLength(1);
    expect(next.updatedAt).toBe(5);
    expect(c.turns).toHaveLength(0);
  });
});

describe("updateChatTitle / renameChat", () => {
  it("sets title and bumps updatedAt", () => {
    const c = createChat({ id: "a", now: 1, folder: "", model: "m" });
    expect(updateChatTitle(c, "Hello world", 10).title).toBe("Hello world");
    expect(renameChat(c, "Custom", 11).updatedAt).toBe(11);
  });
});

describe("deleteChat", () => {
  it("removes by id", () => {
    const chats: Chat[] = [
      createChat({ id: "a", now: 1, folder: "", model: "m" }),
      createChat({ id: "b", now: 2, folder: "", model: "m" }),
    ];
    expect(deleteChat(chats, "a").map((c) => c.id)).toEqual(["b"]);
  });
});

describe("sortChatsByRecency", () => {
  it("orders by updatedAt desc", () => {
    const chats: Chat[] = [
      { ...createChat({ id: "a", now: 1, folder: "", model: "m" }), updatedAt: 5 },
      { ...createChat({ id: "b", now: 1, folder: "", model: "m" }), updatedAt: 10 },
      { ...createChat({ id: "c", now: 1, folder: "", model: "m" }), updatedAt: 1 },
    ];
    expect(sortChatsByRecency(chats).map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});
